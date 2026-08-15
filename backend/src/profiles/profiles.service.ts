import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../entities/profile.entity';
import { Device } from '../entities/device.entity';
import { Rule } from '../entities/rule.entity';
import { DailyUsage } from '../entities/daily-usage.entity';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
  ProfilePolicy,
} from '../network/network-provider.interface';
import {
  ROUTER_PROVIDER,
  RouterProvider,
} from '../router/router-provider.interface';
import { EventsGateway } from '../events/events.gateway';
import { SchedulesService } from '../schedules/schedules.service';
import { effectiveState } from '../common/effective-state';
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
    @InjectRepository(DailyUsage) private dailyUsage: Repository<DailyUsage>,
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
    @Inject(ROUTER_PROVIDER) private router: RouterProvider,
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
    // A switch (or a changed daily limit) changes the effective state, so
    // recompute immediately rather than leaving it until the next tick.
    await this.reevaluate(id);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.network.removeProfileClient(id);
    await this.profiles.delete(id);
    await this.syncBlockedIdentifiers();
  }

  /** Instant pause/resume for a whole profile (manual, bedtime, or quota). */
  /**
   * Flip the parent's manual kill switch. This is all a pause/resume control
   * does now: it sets an *input*, and the evaluator recomputes the effective
   * state from it. Writing internetPaused directly is what previously left the
   * scheduler and the parent fighting over the same field.
   */
  async setSwitch(id: string, internetSwitch: 'auto' | 'off'): Promise<Profile> {
    await this.profiles.update(id, { internetSwitch });
    await this.reevaluate(id);
    return this.findOne(id);
  }

  /** Turn bedtime windows on or off for this profile, independently. */
  async setBedtimeEnabled(id: string, bedtimeEnabled: boolean): Promise<Profile> {
    await this.profiles.update(id, { bedtimeEnabled });
    await this.reevaluate(id);
    return this.findOne(id);
  }

  /**
   * Recompute now instead of waiting up to a minute for the next tick, so a
   * switch takes effect while the parent is still looking at it.
   */
  async reevaluate(id: string): Promise<void> {
    const profile = await this.profiles.findOne({
      where: { id },
      relations: { schedules: true },
    });
    if (!profile) return;

    const now = new Date();
    const active = (profile.schedules ?? []).find((s) => SchedulesService.isActive(s, now));
    const date = now.toISOString().slice(0, 10);
    const usage = await this.dailyUsage.findOne({ where: { profileId: id, date } });

    const state = effectiveState({
      internetSwitch: profile.internetSwitch ?? 'auto',
      bedtimeEnabled: profile.bedtimeEnabled ?? true,
      inBedtimeWindow: !!active,
      bedtimeEndsAt: active?.endTime ?? null,
      dailyLimitMinutes: profile.dailyTimeLimitMinutes,
      usedMinutes: usage?.usedMinutes ?? 0,
      bonusMinutes: usage?.bonusMinutes ?? 0,
    });

    await this.applyEffectiveState(
      id,
      state.blocked,
      state.cause === 'quota' ? 'quota_exceeded' : state.cause ?? undefined,
    );
  }

  /** Persist the computed state and push enforcement. */
  async applyEffectiveState(id: string, blocked: boolean, reason?: string): Promise<Profile> {
    return this.setPaused(id, { paused: blocked, reason });
  }

  async setPaused(id: string, dto: PauseProfileDto): Promise<Profile> {
    await this.profiles.update(id, {
      internetPaused: dto.paused,
      pausedReason: dto.paused ? (dto.reason ?? 'manual') : null,
    });
    await this.syncBlockedIdentifiers();

    const profile = await this.findOne(id);
    if (dto.paused) {
      // Alerts are read by a person on a phone: name the child and the devices
      // affected. A UUID here tells the reader nothing about whose internet
      // just stopped.
      const devices = (profile.devices ?? []).map((d) => d.name).join(', ');
      const on = devices ? ` (${devices})` : '';
      const message =
        dto.reason === 'quota_exceeded'
          ? `Daily limit reached — ${profile.name} paused${on}.`
          : dto.reason === 'bedtime'
            ? `Bedtime started — ${profile.name} paused${on}.`
            : `${profile.name} switched off${on}.`;

      this.events.emitAlert({
        type: dto.reason === 'quota_exceeded' ? 'quota_exceeded' : 'bedtime_pause',
        severity: 'info',
        message,
        profileId: id,
        at: new Date().toISOString(),
      });
    }
    return profile;
  }

  /** Grant extra minutes for today and lift a quota-based pause if present. */
  async grantBonusTime(id: string, minutes: number): Promise<Profile> {
    const date = new Date().toISOString().slice(0, 10);
    let row = await this.dailyUsage.findOne({ where: { profileId: id, date } });
    if (!row) row = this.dailyUsage.create({ profileId: id, date, usedMinutes: 0, bonusMinutes: 0 });
    row.bonusMinutes += Math.max(0, Math.round(minutes));
    await this.dailyUsage.save(row);

    // If they were paused specifically for hitting the quota, resume now.
    const profile = await this.findOne(id);
    if (profile.internetPaused && profile.pausedReason === 'quota_exceeded') {
      await this.setPaused(id, { paused: false });
    }
    return this.findOne(id);
  }

  /** One-tap: pause or resume every profile at once (manual). */
  async pauseAll(paused: boolean): Promise<void> {
    const all = await this.profiles.find();
    for (const p of all) {
      await this.profiles.update(p.id, {
        internetPaused: paused,
        pausedReason: paused ? 'manual' : null,
      });
    }
    await this.syncBlockedIdentifiers();
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
   * Recompute the global hard-block set from every paused profile and every
   * device-level block, and push it to BOTH enforcement layers:
   *  - AdGuard "disallowed clients" (blocks DNS — instant, IP/MAC/ClientID),
   *  - the router firewall by MAC (a true all-traffic cutoff, when configured).
   * Using both means "pause"/bedtime/quota can't be walked around with a
   * hardcoded resolver or a VPN once a router is attached.
   */
  async syncBlockedIdentifiers(): Promise<void> {
    const pausedProfiles = await this.profiles.find({
      where: { internetPaused: true },
      relations: { devices: true },
    });
    const blockedDevices = await this.devices.find({ where: { blocked: true } });

    const identifiers = new Set<string>();
    const macs = new Set<string>();
    const collect = (devices: Device[]) => {
      for (const id of this.identifiersFor(devices)) identifiers.add(id);
      for (const d of devices) if (d.macAddress) macs.add(d.macAddress);
    };
    for (const p of pausedProfiles) collect(p.devices ?? []);
    collect(blockedDevices);

    await this.network.setBlockedClientIdentifiers([...identifiers]);
    if (this.router.isEnabled()) {
      await this.router.setBlockedMacs([...macs]);
    }
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
      // NOTE: no MAC here. AdGuard's *client* definitions accept a MAC, but its
      // access list (which is what enforces a block) accepts only an IP, a CIDR
      // or a ClientID — a MAC makes the whole request fail with
      //   400 "bad ip, cidr, or ClientID"
      // and then NOTHING is blocked. That failure only appears once devices
      // have MACs at all, i.e. after a router provider is enabled, so pause and
      // bedtime silently stop working the moment the router integration lands.
      // The MAC is still used for router-level enforcement (setBlockedMacs).
      if (d.ipAddress) ids.push(d.ipAddress);
    }
    return [...new Set(ids)];
  }
}
