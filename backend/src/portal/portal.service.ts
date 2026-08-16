import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../entities/device.entity';
import { Profile } from '../entities/profile.entity';
import { ActivityLog } from '../entities/activity-log.entity';
import { SchedulesService } from '../schedules/schedules.service';

export type PortalState =
  | 'on'
  | 'bedtime'
  | 'quota'
  | 'paused'
  | 'blocked'
  | 'unfiltered'
  | 'unknown';

/** Silence this long from an online device means we are not its resolver. */
const FILTER_SILENCE_MINUTES = 20;

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
 * Works out what a child's own device should be told.
 *
 * Deliberately read-only and device-scoped: it never reveals other devices,
 * other children, or any parent-side setting. An unrecognised device gets the
 * neutral "can't tell" answer rather than an error — and, importantly, rather
 * than a confident wrong one.
 *
 * Identity is resolved by DeviceIdentityService and passed in. This used to
 * take a source IP, which through Docker's published-port NAT was the same
 * address for every device in the house — so every child was told "Internet is
 * on" no matter what was actually happening to them.
 */
@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(Profile) private profiles: Repository<Profile>,
    @InjectRepository(ActivityLog) private activity: Repository<ActivityLog>,
  ) {}

  async statusForDevice(known: Device | null): Promise<PortalStatus> {
    const unknown: PortalStatus = {
      state: 'unknown',
      deviceId: null,
      deviceName: null,
      profileName: null,
      until: null,
      headline: 'This device is not set up yet',
      detail: 'Ask a parent to add it in Home Guardian.',
    };
    if (!known) return unknown;
    // Re-read so a cookie paired long ago still reflects current state.
    const device = await this.devices.findOne({ where: { id: known.id } });
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
      // Before claiming everything is fine, check we are actually this
      // device's resolver. If it is online but has asked us nothing for a
      // while, it is using another DNS (Private DNS, a VPN) and none of our
      // rules are reaching it — so "Internet is on" would be a guess dressed
      // up as a fact.
      if (device.isOnline && !(await this.filterHasSeen(device))) {
        return {
          ...base,
          state: 'unfiltered',
          profileName: profile?.name ?? null,
          headline: 'Can’t check right now',
          detail:
            'This device isn’t going through Home Guardian at the moment, so it can’t tell you what’s on or off. Ask a parent to check it.',
        };
      }
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
/**
   * Has the filter answered anything for this device recently? If not, we are
   * not in its path and cannot speak for it.
   */
  private async filterHasSeen(device: { ipAddress: string | null }): Promise<boolean> {
    if (!device.ipAddress) return false;
    const row = await this.activity
      .createQueryBuilder('a')
      .select('MAX(a.timestamp)', 'last')
      .where('a.clientIp = :ip', { ip: device.ipAddress })
      .getRawOne<{ last: Date | null }>();
    if (!row?.last) return false;
    return new Date(row.last).getTime() >= Date.now() - FILTER_SILENCE_MINUTES * 60_000;
  }
}
