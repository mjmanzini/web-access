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
  devices?: Device[];
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

export interface Alert {
  type:
    | 'blocked_access'
    | 'bypass_attempt'
    | 'mac_randomized'
    | 'quota_exceeded'
    | 'bedtime_pause'
    | 'device_new';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  profileId?: string | null;
  deviceId?: string | null;
  domain?: string;
  at: string;
}
