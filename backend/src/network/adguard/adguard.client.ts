import axios, { AxiosInstance } from 'axios';

/**
 * Thin, typed wrapper over the AdGuard Home control API (the same API the
 * AdGuard web UI uses, mounted under `/control`). Auth is HTTP Basic. This file
 * knows only about AdGuard's wire shapes — no app concepts leak in here.
 *
 * Reference: https://github.com/AdguardTeam/AdGuardHome/tree/master/openapi
 */

export interface AdguardClient {
  name: string;
  ids: string[];
  use_global_settings: boolean;
  filtering_enabled: boolean;
  parental_enabled: boolean;
  safebrowsing_enabled: boolean;
  safe_search?: {
    enabled: boolean;
    google?: boolean;
    youtube?: boolean;
    bing?: boolean;
    duckduckgo?: boolean;
    pixabay?: boolean;
    yandex?: boolean;
  };
  use_global_blocked_services: boolean;
  blocked_services: string[];
  upstreams?: string[];
  tags?: string[];
}

export interface AdguardAutoClient {
  ip: string;
  name: string;
  source: string;
  whois_info?: Record<string, unknown>;
}

export interface AdguardQueryLogEntry {
  time: string;
  client: string;
  question: { name: string; type: string; class: string };
  reason: string; // e.g. "NotFilteredNotFound", "FilteredBlackList", "Rewrite"
  status?: string;
  elapsedMs: string;
  upstream?: string;
  filterId?: number;
  rule?: string;
}

export interface AdguardDhcpLease {
  mac: string;
  ip: string;
  hostname: string;
  expires?: string;
}

export class AdguardApiClient {
  private http: AxiosInstance;

  constructor(opts: {
    baseUrl: string;
    username: string;
    password: string;
    timeoutMs?: number;
  }) {
    this.http = axios.create({
      baseURL: opts.baseUrl.replace(/\/+$/, '') + '/control',
      auth: { username: opts.username, password: opts.password },
      timeout: opts.timeoutMs ?? 8000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async status(): Promise<{ version: string; running: boolean }> {
    const { data } = await this.http.get('/status');
    return { version: data?.version ?? null, running: data?.running ?? true };
  }

  // ---- Clients (per-profile settings) ----

  async listClients(): Promise<{
    clients: AdguardClient[];
    auto_clients: AdguardAutoClient[];
  }> {
    const { data } = await this.http.get('/clients');
    return {
      clients: data?.clients ?? [],
      auto_clients: data?.auto_clients ?? [],
    };
  }

  async addClient(client: AdguardClient): Promise<void> {
    await this.http.post('/clients/add', client);
  }

  async updateClient(name: string, client: AdguardClient): Promise<void> {
    await this.http.post('/clients/update', { name, data: client });
  }

  async deleteClient(name: string): Promise<void> {
    await this.http.post('/clients/delete', { name });
  }

  /** Upsert convenience: try update, fall back to add. */
  async upsertClient(client: AdguardClient): Promise<void> {
    try {
      await this.updateClient(client.name, client);
    } catch {
      await this.addClient(client);
    }
  }

  // ---- Access control (hard block a client's DNS entirely) ----

  async getAccessList(): Promise<{
    allowed_clients: string[];
    disallowed_clients: string[];
    blocked_hosts: string[];
  }> {
    const { data } = await this.http.get('/access/list');
    return {
      allowed_clients: data?.allowed_clients ?? [],
      disallowed_clients: data?.disallowed_clients ?? [],
      blocked_hosts: data?.blocked_hosts ?? [],
    };
  }

  async setAccessList(list: {
    allowed_clients: string[];
    disallowed_clients: string[];
    blocked_hosts: string[];
  }): Promise<void> {
    await this.http.post('/access/set', list);
  }

  // ---- Global custom filtering rules ----

  async getUserRules(): Promise<string[]> {
    const { data } = await this.http.get('/filtering/status');
    return data?.user_rules ?? [];
  }

  async setUserRules(rules: string[]): Promise<void> {
    await this.http.post('/filtering/set_rules', { rules });
  }

  // ---- Query log (activity feed) ----

  async queryLog(limit = 200): Promise<AdguardQueryLogEntry[]> {
    const { data } = await this.http.get('/querylog', { params: { limit } });
    return data?.data ?? [];
  }

  // ---- DHCP leases (best source of IP↔MAC↔hostname) ----

  async dhcpLeases(): Promise<AdguardDhcpLease[]> {
    try {
      const { data } = await this.http.get('/dhcp/status');
      return [...(data?.leases ?? []), ...(data?.static_leases ?? [])];
    } catch {
      // DHCP server not enabled in AdGuard — MACs come from another source.
      return [];
    }
  }
}
