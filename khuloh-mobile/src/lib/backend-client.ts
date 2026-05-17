import * as SecureStore from "expo-secure-store";
import type { Profile } from "../types/profile";

export type BackendUser = {
  id: string;
  username?: string | null;
  displayName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
};

const BACKEND_TOKEN_KEY = "khuloh.backendToken";

function envValue(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

export function getBackendBaseUrl() {
  return envValue("EXPO_PUBLIC_SIGNALING_URL")
    || envValue("EXPO_PUBLIC_API_URL")
    || "http://localhost:4000";
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(String((payload as { error?: string } | null)?.error || `request_failed_${response.status}`));
  }
  return payload as T;
}

export async function getStoredBackendToken() {
  return SecureStore.getItemAsync(BACKEND_TOKEN_KEY);
}

export async function storeBackendToken(token: string) {
  await SecureStore.setItemAsync(BACKEND_TOKEN_KEY, token);
}

export async function clearBackendToken() {
  await SecureStore.deleteItemAsync(BACKEND_TOKEN_KEY);
}

export async function registerBackendSession(input: {
  phone?: string;
  email?: string;
  displayName: string;
  username?: string;
}) {
  return request<BackendUser & { token: string }>(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function fetchMe(token: string) {
  const data = await request<{ user: BackendUser }>("/api/me", {}, token);
  return data.user;
}

export async function fetchMyProfile(token: string) {
  const data = await request<{ profile: Profile }>("/api/khuloh/profile/me", {}, token);
  return data.profile;
}

export async function updateMyProfile(
  token: string,
  input: {
    username?: string | null;
    bio?: string | null;
    vibe?: Profile["vibe"];
    city?: string | null;
    dataLightMode?: boolean;
  },
) {
  const data = await request<{ profile: Profile }>(
    "/api/khuloh/profile/me",
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    token,
  );
  return data.profile;
}