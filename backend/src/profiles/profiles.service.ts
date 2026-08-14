import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../entities/profile.entity';
import { Device } from '../entities/device.entity';
import { Rule } from '../entities/rule.entity';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
  ProfilePolicy,
} from '../network/network-provider.interface';
import { EventsGateway } from '../events/events.gateway';
import {
  CreateProfileDto,
  PauseProfileDto,
  UpdateProfileDto,
} from './dto/profile.dto';

/**
 * Owns profiles AND the compilation of a profile's DB state into a
 * vendor-neutral ProfilePolicy that the network provider enforces. Devices/Rules
 * services call `syncProfile()` after any change so the appliance always matches
 * the database (the DB is the source of truth; the appliance is reconciled to it).
 */
@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(Rule) private rules: Repository<Rule>,
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
    private events: EventsGateway,
  ) {}

  findAll(): Promise<Profile[]> {
    return this.profiles.find({ relations: { devices: true } });
  }

  async findOne(id: string): Promise<Profile> {
    const profile = await this.profiles.findOne({
      where: { id },
      relations: { devices: true, rules: true, schedules: true },
    });
    if (!profile) throw new NotFoundException(`Profile ${id} not found`);
    return profile;
  }

  async create(dto: CreateProfileDto): Promise<Profile> {
    const profile = this.profiles.create({
      ...dto,
      blockedCategories: dto.blockedCategories ?? [],
    });
    const saved = await this.profiles.save(profile);
    await this.syncProfile(saved.id);
    return saved;
  }

  async update(id: string, dto: UpdateProfileDto): Promise<Profile> {
    await this.profiles.update(id, dto);
    await this.syncProfile(id);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.network.removeProfileClient(id);
    await this.profiles.delete(id);
    await this.syncBlockedIdentifiers();
  }

  /** Instant pause/resume for a whole profile (manual, bedtime, or quota). */
  async setPaused(id: string, dto: PauseProfileDto): Promise<Profile> {
    await this.profiles.update(id, {
      internetPaused: dto.paused,
      pausedReason: dto.paused ? (dto.reason ?? 'manual') : null,
    });
    await this.syncBlockedIdentifiers();
    if (dto.paused) {
      this.events.emitAlert({
        type: dto.reason === 'quota_exceeded' ? 'quota_exceeded' : 'bedtime_pause',
        severity: 'info',
        message: `Internet paused for profile ${id} (${dto.reason ?? 'manual'})`,
        profileId: id,
        at: new Date().toISOString(),
      });
    }
    return this.findOne(id);
  }

  // ---- policy compilation + reconciliation ----

  /** Compile a profile's DB state into the vendor-neutral policy shape. */
  async buildPolicy(id: string): Promise<ProfilePolicy> {
    const profile = await this.findOne(id);
    const enabledRules = (profile.rules ?? []).filter(
      (r) => r.enabled && r.type === 'domain',
    );
    return {
      clientKey: profile.id,
      displayName: profile.name,
      identifiers: this.identifiersFor(profile.devices ?? []),
      blockedCategories: profile.blockedCategories ?? [],
      safeSearch: profile.safeSearchEnforced,
      youtubeRestricted: profile.youtubeRestricted,
      blockDnsBypass: profile.blockDnsBypass,
      blockDomains: enabledRules
        .filter((r) => r.action === 'block')
        .map((r) => r.value),
      allowDomains: enabledRules
        .filter((r) => r.action === 'allow')
        .map((r) => r.value),
      internetPaused: profile.internetPaused,
    };
  }

  /** Push one profile's full policy to the appliance. */
  async syncProfile(id: string): Promise<void> {
    const policy = await this.buildPolicy(id);
    await this.network.applyProfilePolicy(policy);
    await this.syncBlockedIdentifiers();
  }

  /**
   * Recompute the global hard-block set: identifiers of every paused profile and
   * every device-level block, pushed as AdGuard "disallowed clients". This is
   * how pause/bedtime/quota take effect immediately.
   */
  async syncBlockedIdentifiers(): Promise<void> {
    const pausedProfiles = await this.profiles.find({
      where: { internetPaused: true },
      relations: { devices: true },
    });
    const blockedDevices = await this.devices.find({ where: { blocked: true } });

    const identifiers = new Set<string>();
    for (const p of pausedProfiles) {
      for (const id of this.identifiersFor(p.devices ?? [])) identifiers.add(id);
    }
    for (const d of blockedDevices) {
      if (d.clientId) identifiers.add(d.clientId);
      if (d.macAddress && !d.macRandomized) identifiers.add(d.macAddress);
      if (d.ipAddress) identifiers.add(d.ipAddress);
    }
    await this.network.setBlockedClientIdentifiers([...identifiers]);
  }

  /**
   * Build the AdGuard client identifiers for a set of devices, most-stable
   * first: the ClientID (IP-independent, survives MAC randomization), then a
   * non-randomized MAC, then the current IP as a last-resort fallback. Including
   * all three means enforcement holds however the device is currently reaching
   * AdGuard (encrypted DNS with a ClientID, or plain DNS by IP/MAC).
   */
  private identifiersFor(devices: Device[]): string[] {
    const ids: string[] = [];
    for (const d of devices) {
      if (d.clientId) ids.push(d.clientId); // durable anchor
      if (d.macAddress && !d.macRandomized) ids.push(d.macAddress);
      if (d.ipAddress) ids.push(d.ipAddress);
    }
    return [...new Set(ids)];
  }
}
