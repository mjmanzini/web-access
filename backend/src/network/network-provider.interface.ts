/**
 * NetworkProvider is the seam between "what the backend wants" and "how a
 * specific DNS/network appliance enforces it". AdguardService is the reference
 * implementation; a PiholeService or OpenWrtService can be dropped in later
 * without touching devices/rules/schedules code. Everything above this
 * interface is vendor-neutral.
 */

export const NETWORK_PROVIDER = Symbol('NETWORK_PROVIDER');

/** A device as seen by the network layer (before we persist/enrich it). */
export interface DiscoveredDevice {
  ip: string;
  mac: string | null;
  name: string | null;
  online: boolean;
  lastSeen: Date | null;
  /**
   * Identification detail, when the source has it. Optional because AdGuard
   * knows none of it — only the router sees how a device is attached.
   */
  connection?: 'wireless' | 'ethernet' | null;
  ssid?: string | null;
  addressSource?: string | null;
}

/** One query-log line, normalized across providers. */
export interface NetworkQueryLogEntry {
  timestamp: Date;
  clientIp: string;
  domain: string;
  queryType: string;
  action: 'allowed' | 'blocked' | 'rewritten';
  category: string | null;
  upstream: string | null;
  elapsedMs: number | null;
}

/**
 * The per-profile policy the network layer must enforce. The backend compiles
 * DB state (Profile + its Devices + Rules) into one of these and hands it over;
 * the provider is responsible for making the appliance match it (idempotently).
 */
export interface ProfilePolicy {
  /** Stable client name in the appliance (we use the Profile id). */
  clientKey: string;
  displayName: string;
  /** Identifiers that map traffic to this client: IPs, CIDRs, or MACs. */
  identifiers: string[];
  blockedCategories: string[];
  safeSearch: boolean;
  youtubeRestricted: boolean;
  blockDnsBypass: boolean;
  /** Extra allow/deny domains scoped to this profile. */
  allowDomains: string[];
  blockDomains: string[];
  /** When true the profile has no internet right now (pause/bedtime/quota). */
  internetPaused: boolean;
}

export interface NetworkProvider {
  /** Liveness + version of the appliance, for the dashboard health card. */
  getStatus(): Promise<{ running: boolean; version: string | null }>;

  /** Devices the appliance currently knows about (configured + auto-discovered). */
  discoverDevices(): Promise<DiscoveredDevice[]>;

  /** Create/update the appliance client for a profile and apply its policy. */
  applyProfilePolicy(policy: ProfilePolicy): Promise<void>;

  /** Remove the appliance client for a profile (on profile delete). */
  removeProfileClient(clientKey: string): Promise<void>;

  /** Replace the network-wide (all clients) allow/block domain rules. */
  setGlobalDomainRules(
    blockDomains: string[],
    allowDomains: string[],
  ): Promise<void>;

  /**
   * Replace the set of client identifiers that are hard-blocked right now
   * (used for immediate pause / bedtime / quota cutoff across profiles).
   */
  setBlockedClientIdentifiers(identifiers: string[]): Promise<void>;

  /**
   * Block streaming video for these clients ahead of a full block. DNS cannot
   * stop a video that is already playing, so the only way bedtime lands on time
   * is to stop new streams starting shortly before it.
   */
  setPreBedtimeIdentifiers(identifiers: string[]): Promise<void>;

  /** Pull recent query-log entries, newest first, up to `limit`. */
  fetchQueryLog(limit: number): Promise<NetworkQueryLogEntry[]>;
}
