import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequest } from '../entities/access-request.entity';
import { Device } from '../entities/device.entity';
import { RulesService } from '../rules/rules.service';
import { EventsGateway } from '../events/events.gateway';

/**
 * The "ask a parent to unblock this" queue. A device submits a request (mapped
 * to its device/profile by source IP); the parent approves — which creates a
 * scoped allow Rule and pushes it to the network layer — or denies.
 */
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    @InjectRepository(AccessRequest) private requests: Repository<AccessRequest>,
    @InjectRepository(Device) private devices: Repository<Device>,
    private rules: RulesService,
    private events: EventsGateway,
  ) {}

  /** Submit a request from a device (identified by its current IP). */
  async submit(clientIp: string, domain: string, note?: string): Promise<AccessRequest> {
    const device = await this.devices.findOne({ where: { ipAddress: clientIp } });
    const req = await this.requests.save(
      this.requests.create({
        domain: domain.trim().toLowerCase(),
        note: note?.slice(0, 280) ?? null,
        clientIp,
        deviceId: device?.id ?? null,
        profileId: device?.profileId ?? null,
        status: 'pending',
      }),
    );
    this.events.emitAlert({
      type: 'blocked_access',
      severity: 'info',
      message: `Access request: ${device?.name ?? clientIp} is asking to unblock ${req.domain}.`,
      deviceId: device?.id ?? null,
      profileId: device?.profileId ?? null,
      domain: req.domain,
      at: new Date().toISOString(),
    });
    return req;
  }

  pending(): Promise<AccessRequest[]> {
    return this.requests.find({
      where: { status: 'pending' },
      order: { createdAt: 'DESC' },
    });
  }

  /** Approve → create an allow rule (profile-scoped if known, else global). */
  async approve(id: string): Promise<AccessRequest> {
    const req = await this.get(id);
    await this.rules.create({
      type: 'domain',
      value: req.domain,
      action: 'allow',
      scope: req.profileId ? 'profile' : 'global',
      profileId: req.profileId ?? undefined,
    });
    return this.resolve(req, 'approved');
  }

  async deny(id: string): Promise<AccessRequest> {
    return this.resolve(await this.get(id), 'denied');
  }

  private async get(id: string): Promise<AccessRequest> {
    const req = await this.requests.findOne({ where: { id } });
    if (!req) throw new NotFoundException(`Request ${id} not found`);
    return req;
  }

  private async resolve(
    req: AccessRequest,
    status: 'approved' | 'denied',
  ): Promise<AccessRequest> {
    req.status = status;
    req.resolvedAt = new Date();
    this.logger.log(`Access request ${req.domain} ${status}`);
    return this.requests.save(req);
  }
}
