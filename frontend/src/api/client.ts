import type {
  ActivityLog,
  BandwidthRow,
  Device,
  DnsSetup,
  Profile,
  RouterStatus,
  Rule,
} from './types';
import { auth } from './auth';

// Same-origin relative base — the Vite dev proxy (and Cloudflare in prod) route
// /api to the NestJS backend. Override with VITE_API_BASE if hosting split.
const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401) {
    auth.clear(); // token missing/expired → bounce to login
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  // auth
  login: (username: string, password: string) =>
    request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => request<{ id: string; username: string }>('/auth/me'),

  // profiles
  profiles: () => request<Profile[]>('/profiles'),
  profile: (id: string) => request<Profile>(`/profiles/${id}`),
  createProfile: (body: Partial<Profile>) =>
    request<Profile>('/profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (id: string, body: Partial<Profile>) =>
    request<Profile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  pauseProfile: (id: string, paused: boolean, reason = 'manual') =>
    request<Profile>(`/profiles/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ paused, reason }),
    }),

  // devices
  devices: () => request<Device[]>('/devices'),
  dnsSetup: (id: string) => request<DnsSetup>(`/devices/${id}/dns-setup`),
  syncDevices: () => request<{ discovered: number; created: number }>('/devices/sync', { method: 'POST' }),
  updateDevice: (id: string, body: Partial<Device>) =>
    request<Device>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // rules
  rules: () => request<Rule[]>('/rules'),
  createRule: (body: Partial<Rule>) =>
    request<Rule>('/rules', { method: 'POST', body: JSON.stringify(body) }),
  deleteRule: (id: string) => request<void>(`/rules/${id}`, { method: 'DELETE' }),

  // activity
  activity: (limit = 100) => request<ActivityLog[]>(`/activity?limit=${limit}`),
  networkStatus: () => request<{ running: boolean; version: string | null }>('/network/status'),

  // router + bandwidth
  bandwidth: () => request<BandwidthRow[]>('/bandwidth'),
  routerStatus: () => request<RouterStatus>('/router/status'),
  applyContainment: () =>
    request<{ applied: boolean; rules: string[] }>('/router/containment', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
