import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rule } from '../entities/rule.entity';
import { Profile } from '../entities/profile.entity';
import {
  NETWORK_PROVIDER,
  NetworkProvider,
} from '../network/network-provider.interface';
import { ProfilesService } from '../profiles/profiles.service';
import { CreateRuleDto, UpdateRuleDto } from './dto/rule.dto';

/**
 * Manages filtering rules and reconciles them to the network layer. Profile- and
 * device-scoped rules re-push that profile's policy; global rules are pushed as
 * network-wide domain rules. Category rules are stored here for the UI but are
 * enforced through the profile's `blockedCategories` (see ProfilesService), so a
 * profile-scoped category rule updates the profile and re-syncs it.
 */
@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    @InjectRepository(Rule) private rules: Repository<Rule>,
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @Inject(NETWORK_PROVIDER) private network: NetworkProvider,
    private profilesService: ProfilesService,
  ) {}

  findAll(): Promise<Rule[]> {
    return this.rules.find({ order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateRuleDto): Promise<Rule> {
    if (dto.scope === 'profile' && !dto.profileId)
      throw new BadRequestException('profileId required for profile-scoped rule');
    if (dto.scope === 'device' && !dto.deviceId)
      throw new BadRequestException('deviceId required for device-scoped rule');

    const rule = this.rules.create({
      type: dto.type,
      value: dto.value.trim().toLowerCase(),
      action: dto.action ?? 'block',
      scope: dto.scope,
      profileId: dto.profileId ?? null,
      deviceId: dto.deviceId ?? null,
      enabled: true,
    });
    const saved = await this.rules.save(rule);
    await this.reconcile(saved);
    return saved;
  }

  async update(id: string, dto: UpdateRuleDto): Promise<Rule> {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Rule ${id} not found`);
    Object.assign(rule, dto);
    const saved = await this.rules.save(rule);
    await this.reconcile(saved);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Rule ${id} not found`);
    await this.rules.delete(id);
    await this.reconcile(rule);
  }

  /**
   * Push the current rule state to the network layer for whatever scope the
   * given rule touches. Category rules fold into the profile's blockedCategories.
   */
  private async reconcile(rule: Rule): Promise<void> {
    if (rule.type === 'category' && rule.scope === 'profile' && rule.profileId) {
      await this.applyCategoryToProfile(rule);
      return;
    }

    if (rule.scope === 'global') {
      const globals = await this.rules.find({
        where: { scope: 'global', type: 'domain', enabled: true },
      });
      await this.network.setGlobalDomainRules(
        globals.filter((r) => r.action === 'block').map((r) => r.value),
        globals.filter((r) => r.action === 'allow').map((r) => r.value),
      );
    } else if (rule.profileId) {
      await this.profilesService.syncProfile(rule.profileId);
    } else if (rule.deviceId) {
      // Device-scoped domain rules ride the owning profile's policy for now.
      const profile = await this.profiles
        .createQueryBuilder('p')
        .innerJoin('p.devices', 'd', 'd.id = :id', { id: rule.deviceId })
        .getOne();
      if (profile) await this.profilesService.syncProfile(profile.id);
    }

    await this.rules.update(rule.id, { syncedAt: new Date() });
  }

  /** Merge/unmerge a category slug into the profile and re-sync it. */
  private async applyCategoryToProfile(rule: Rule): Promise<void> {
    const profile = await this.profiles.findOne({
      where: { id: rule.profileId! },
    });
    if (!profile) return;
    const set = new Set(profile.blockedCategories ?? []);
    if (rule.enabled && rule.action === 'block') set.add(rule.value);
    else set.delete(rule.value);
    profile.blockedCategories = [...set];
    await this.profiles.save(profile);
    await this.profilesService.syncProfile(profile.id);
    await this.rules.update(rule.id, { syncedAt: new Date() });
  }
}
