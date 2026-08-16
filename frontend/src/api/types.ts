// Shared shapes mirroring the backend entities/DTOs. Kept intentionally small —
// extend as the UI grows.

export interface Profile {
  id: string;
  name: string;
  kind: string;
  blockedCategories: string[];
  safeSearchEnforced: boolean;
  youtubeRestricted: boolean;
  blockDnsBypass: boolean;
  dailyTimeLimitMinutes: number | null;
  internetPaused: boolean;
  pausedReason: string | null;
  /** Parent kill switch: 'off' blocks regardless of schedule or quota. */
  internetSwitch: 'auto' | 'off';
  /** Whether bedtime windows apply to this profile at all. */
  bedtimeEnabled: boolean;
  devices?: Device[];
}

/** A recurring block window for a profile — bedtime, homework hours, etc. */
export interface Schedule {
  id: string;
  label: string;
  /** 0=Sun .. 6=Sat. Empty means every day. */
  daysOfWeek: string[];
  /** 24h "HH:mm" local time; a window may cross midnight (start > end). */
  startTime: string;
  endTime: string;
  enabled: boolean;
  profileId: string;
}

export interface Device {
  id: string;
  name: string;
  clientId: string | null;
  ipAddress: string;
  macAddress: string | null;
  macRandomized: boolean;
  vendor: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  /** When the filter last saw a DNS query from this device. */
  lastFilteredAt?: string | null;
  /** False when the device is online but resolving somewhere other than us. */
  usingFilter?: boolean;
  blocked: boolean;
  profileId: string | null;
}

export interface DnsSetup {
  clientId: string;
  domainConfigured: boolean;
  dot: string | null;
  doh: string | null;
  doq: string | null;
}

export interface Rule {
  id: string;
  type: 'domain' | 'category';
  value: string;
  action: 'block' | 'allow';
  scope: 'global' | 'profile' | 'device';
  enabled: boolean;
  profileId: string | null;
  deviceId: string | null;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  clientIp: string;
  deviceId: string | null;
  profileId: string | null;
  domain: string;
  action: 'allowed' | 'blocked' | 'rewritten';
  category: string | null;
  /** Friendly device name resolved at read time; null for unknown clients. */
  deviceName: string | null;
}

export interface BandwidthRow {
  deviceId: string;
  name: string;
  rxBytesToday: number;
  txBytesToday: number;
  rxRateBps: number;
  txRateBps: number;
}

export interface RouterStatus {
  enabled: boolean;
  reachable: boolean;
  model: string | null;
  containment: { applied: boolean; rules: string[] };
}

export interface AccessRequest {
  id: string;
  domain: string;
  note: string | null;
  clientIp: string;
  deviceId: string | null;
  profileId: string | null;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
}

/**
 * What a device did, measured — lookups and active minutes, never bytes. The
 * filter sees DNS names, not traffic volume, and this router exposes no
 * per-host counters, so megabytes would be a guess dressed as a number.
 */
export interface DeviceActivity {
  deviceId: string;
  name: string;
  isOnline: boolean;
  activeMinutesToday: number;
  activeMinutesWeek: number;
  lookupsToday: number;
  lookupsWeek: number;
  blockedToday: number;
  topDomain: string | null;
}

export interface ProfileReport {
  profileId: string;
  name: string;
  today: { usedMinutes: number; limitMinutes: number | null; bonusMinutes: number };
  last7Days: Array<{ date: string; usedMinutes: number }>;
  topDomains: Array<{ domain: string; hits: number }>;
  devices: DeviceActivity[];
  deviceTotals: { activeMinutesToday: number; lookupsToday: number; blockedToday: number };
}

export interface SystemHealth {
  healthy: boolean;
  components: Array<{
    name: string;
    up: boolean;
    fails: number;
    lastOkAt: string | null;
    downSince: string | null;
  }>;
  deadManPing: { url: boolean; lastPingAt: string | null };
}

export interface Alert {
  type:
    | 'blocked_access'
    | 'bypass_attempt'
    | 'mac_randomized'
    | 'quota_exceeded'
    | 'bedtime_pause'
    | 'device_new'
    | 'system_down'
    | 'system_recovered';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  profileId?: string | null;
  deviceId?: string | null;
  domain?: string;
  at: string;
}

/** A dashboard login. Two roles: 'admin' manages accounts, 'parent' does not. */
export interface ParentAccount {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: 'admin' | 'parent';
  createdAt: string;
  hasPassword: boolean;
  pendingInvite: boolean;
}

export interface InviteLink {
  token: string;
  url: string;
  expiresAt: string;
}
