import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../entities/device.entity';
import { DeviceUsage } from '../entities/device-usage.entity';
import {
  ROUTER_PROVIDER,
  RouterProvider,
} from '../router/router-provider.interface';

interface Snapshot {
  rx: number;
  tx: number;
}

export interface BandwidthRow {
  deviceId: string;
  name: string;
  rxBytesToday: number;
  txBytesToday: number;
  rxRateBps: number;
  txRateBps: number;
}

/**
 * Turns the router's cumulative per-MAC counters into per-device usage. Every
 * poll it diffs against the previous snapshot (handling counter resets), adds
 * the delta to today's DeviceUsage, and keeps a short-lived rate (bytes/sec) for
 * the live view. No-op when no router is configured.
 */
@Injectable()
export class BandwidthService {
  private readonly logger = new Logger(BandwidthService.name);
  private lastByMac = new Map<string, Snapshot>();
  private lastPollAt = 0;
  private rateByDevice = new Map<string, { rx: number; tx: number }>();

  constructor(
    @InjectRepository(Device) private devices: Repository<Device>,
    @InjectRepository(DeviceUsage) private usage: Repository<DeviceUsage>,
    @Inject(ROUTER_PROVIDER) private router: RouterProvider,
  ) {}

  @Interval(60_000)
  async poll(): Promise<void> {
    if (!this.router.isEnabled()) return;
    try {
      await this.ingest();
    } catch (e) {
      this.logger.warn(`bandwidth poll failed: ${(e as Error).message}`);
    }
  }

  /** One accounting cycle: read counters, diff, accrue, update rates. */
  async ingest(): Promise<void> {
    const samples = await this.router.getBandwidth();
    const now = Date.now();
    const elapsedSec = this.lastPollAt ? (now - this.lastPollAt) / 1000 : 0;
    const date = new Date().toISOString().slice(0, 10);

    const macToDevice = new Map<string, Device>();
    for (const d of await this.devices.find()) {
      if (d.macAddress) macToDevice.set(d.macAddress, d);
    }

    const nextRates = new Map<string, { rx: number; tx: number }>();

    for (const s of samples) {
      const prev = this.lastByMac.get(s.mac);
      // Counter reset (nlbwmon period rollover) → treat current as the delta.
      const dRx = !prev || s.rxBytes < prev.rx ? s.rxBytes : s.rxBytes - prev.rx;
      const dTx = !prev || s.txBytes < prev.tx ? s.txBytes : s.txBytes - prev.tx;
      this.lastByMac.set(s.mac, { rx: s.rxBytes, tx: s.txBytes });

      const device = macToDevice.get(s.mac);
      if (!device) continue;

      if (dRx || dTx) await this.accrue(device.id, date, dRx, dTx);
      if (elapsedSec > 0) {
        nextRates.set(device.id, {
          rx: Math.round(dRx / elapsedSec),
          tx: Math.round(dTx / elapsedSec),
        });
      }
    }

    this.rateByDevice = nextRates;
    this.lastPollAt = now;
  }

  private async accrue(deviceId: string, date: string, dRx: number, dTx: number) {
    const row = await this.usage.findOne({ where: { deviceId, date } });
    if (row) {
      row.rxBytes = String(BigInt(row.rxBytes) + BigInt(dRx));
      row.txBytes = String(BigInt(row.txBytes) + BigInt(dTx));
      await this.usage.save(row);
    } else {
      await this.usage.save(
        this.usage.create({ deviceId, date, rxBytes: String(dRx), txBytes: String(dTx) }),
      );
    }
  }

  /** Per-device totals for today plus the latest sampled rate. */
  async summary(): Promise<BandwidthRow[]> {
    const date = new Date().toISOString().slice(0, 10);
    const [devices, todays] = await Promise.all([
      this.devices.find(),
      this.usage.find({ where: { date } }),
    ]);
    const byDevice = new Map(todays.map((u) => [u.deviceId, u]));
    return devices.map((d) => {
      const u = byDevice.get(d.id);
      const rate = this.rateByDevice.get(d.id) ?? { rx: 0, tx: 0 };
      return {
        deviceId: d.id,
        name: d.name,
        rxBytesToday: u ? Number(u.rxBytes) : 0,
        txBytesToday: u ? Number(u.txBytes) : 0,
        rxRateBps: rate.rx,
        txRateBps: rate.tx,
      };
    });
  }
}
