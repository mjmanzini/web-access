import type {
  AccessRequest,
  ActivityLog,
  BandwidthRow,
  Device,
  DnsSetup,
  Profile,
  ProfileReport,
  RouterStatus,
  Rule,
  Schedule,
  SystemHealth,
} from './types';
import { auth } from './auth';

// Same-origin relative base — the Vite dev proxy (and Cloudflare in prod) route
// /api to the NestJS backend. Override with VITE_API_BASE if hosting split.
const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api';

async function request<T>(
  path: string,
  init?: RequestInit,
  // Some endpoints answer 401 to mean "that input was wrong", not "your session
  // expired" — change-password rejecting the current password, for example.
  // Those pass keepSessionOn401 so a typo doesn't sign the user out.
  opts?: { keepSessionOn401?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401 && !opts?.keepSessionOn401) {
    auth.clear(); // token missing/expired → bounce to login
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Nest's validation pipe returns `message` as an array of failures.
    const detail = Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new Error(detail ?? `${res.status} ${res.statusText}`);
  }
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
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>(
      '/auth/change-password',
      { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
      { keepSessionOn401: true },
    ),

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
  pauseAll: (paused: boolean) =>
    request<void>('/profiles/pause-all', { method: 'POST', body: JSON.stringify({ paused }) }),
  bonusTime: (id: string, minutes: number) =>
    request<Profile>(`/profiles/${id}/bonus-time`, {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    }),
  report: (id: string) => request<ProfileReport>(`/reports/profile/${id}`),

  // web push
  pushConfig: () => request<{ enabled: boolean; publicKey: string | null; devices: number }>('/push/config'),
  pushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: true }>('/push/subscribe', { method: 'POST', body: JSON.stringify(body) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: true }>('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  pushTest: () => request<{ delivered: number }>('/push/test', { method: 'POST' }),

  // schedules (bedtime / homework windows)
  schedules: (profileId: string) =>
    request<Schedule[]>(`/profiles/${profileId}/schedules`),
  createSchedule: (profileId: string, body: Partial<Schedule>) =>
    request<Schedule>(`/profiles/${profileId}/schedules`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSchedule: (id: string, body: Partial<Schedule>) =>
    request<Schedule>(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSchedule: (id: string) => request<void>(`/schedules/${id}`, { method: 'DELETE' }),

  // access requests
  pendingRequests: () => request<AccessRequest[]>('/requests/pending'),
  approveRequest: (id: string) => request<AccessRequest>(`/requests/${id}/approve`, { method: 'POST' }),
  denyRequest: (id: string) => request<AccessRequest>(`/requests/${id}/deny`, { method: 'POST' }),

  // devices
  devices: () => request<Device[]>('/devices'),
  dnsSetup: (id: string) => request<DnsSetup>(`/devices/${id}/dns-setup`),
  syncDevices: () => request<{ discovered: number; created: number }>('/devices/sync', { method: 'POST' }),
  updateDevice: (id: string, body: Partial<Device>) =>
    request<Device>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteDevice: (id: string) => request<void>(`/devices/${id}`, { method: 'DELETE' }),

  // rules
  rules: () => request<Rule[]>('/rules'),
  createRule: (body: Partial<Rule>) =>
    request<Rule>('/rules', { method: 'POST', body: JSON.stringify(body) }),
  deleteRule: (id: string) => request<void>(`/rules/${id}`, { method: 'DELETE' }),

  // activity
  activity: (limit = 100, deviceId?: string) =>
    request<ActivityLog[]>(
      `/activity?limit=${limit}${deviceId ? `&deviceId=${encodeURIComponent(deviceId)}` : ''}`,
    ),
  networkStatus: () => request<{ running: boolean; version: string | null }>('/network/status'),
  systemHealth: () => request<SystemHealth>('/system/health'),

  // router + bandwidth
  bandwidth: () => request<BandwidthRow[]>('/bandwidth'),
  routerStatus: () => request<RouterStatus>('/router/status'),
  applyContainment: () =>
    request<{ applied: boolean; rules: string[] }>('/router/containment', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
