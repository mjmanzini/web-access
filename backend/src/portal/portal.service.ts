import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../entities/device.entity';
import { Profile } from '../entities/profile.entity';
import { SchedulesService } from '../schedules/schedules.service';

export type PortalState = 'on' | 'bedtime' | 'quota' | 'paused' | 'blocked' | 'unknown';

export interface PortalStatus {
  state: PortalState;
  /** This device's id, when we recognise it — used to scope its own push. */
  deviceId: string | null;
  deviceName: string | null;
  profileName: string | null;
  /** "06:00" — when the current bedtime window ends, if that's why it's off. */
  until: string | null;
  headline: string;
  detail: string;
}

/**
 * Works out what a child's own device should be told, from its source IP alone.
 *
 * Deliberately read-only and device-scoped: it never reveals other devices,
 * other children, or any parent-side setting. An unrecognised IP simply gets
 * the neutral "can't tell" answer rather than an error.
 */
@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(Profile) private profiles: Repository<Profile>,
  ) {}

  async statusForIp(ip: string): Promise<PortalStatus> {
    const unknown: PortalStatus = {
      state: 'unknown',
      deviceId: null,
      deviceName: null,
      profileName: null,
      until: null,
      headline: 'This device is not set up yet',
      detail: 'Ask a parent to add it in Home Guardian.',
    };
    if (!ip) return unknown;

    const device = await this.devices.findOne({ where: { ipAddress: ip } });
    if (!device) return unknown;

    const base = {
      deviceId: device.id,
      deviceName: device.name,
      until: null as string | null,
    };

    if (device.blocked) {
      return {
        ...base,
        state: 'blocked',
        profileName: null,
        headline: 'Internet is paused',
        detail: 'A parent paused the internet on this device. It will come back when they turn it on again.',
      };
    }

    const profile = device.profileId
      ? await this.profiles.findOne({
          where: { id: device.profileId },
          relations: { schedules: true },
        })
      : null;

    if (!profile || !profile.internetPaused) {
      return {
        ...base,
        state: 'on',
        profileName: profile?.name ?? null,
        headline: 'Internet is on',
        detail: profile
          ? `You're all good. Some sites may still be blocked for ${profile.name}.`
          : "You're all good.",
      };
    }

    // Paused — say *why*, because "it just stopped working" is the thing that
    // sends a child to a parent confused rather than informed.
    if (profile.pausedReason === 'bedtime') {
      const active = (profile.schedules ?? []).find((s) =>
        SchedulesService.isActive(s, new Date()),
      );
      return {
        ...base,
        state: 'bedtime',
        profileName: profile.name,
        until: active?.endTime ?? null,
        headline: 'It’s bedtime',
        detail: active
          ? `The internet is off until ${active.endTime}. It will switch back on by itself.`
          : 'The internet is off for bedtime. It will switch back on by itself.',
      };
    }

    if (profile.pausedReason === 'quota_exceeded') {
      return {
        ...base,
        state: 'quota',
        profileName: profile.name,
        headline: 'Screen time is used up',
        detail: "You've used all of today's internet time. It resets tomorrow morning.",
      };
    }

    return {
      ...base,
      state: 'paused',
      profileName: profile.name,
      headline: 'Internet is paused',
      detail: 'A parent paused the internet. It will come back when they turn it on again.',
    };
  }
}
