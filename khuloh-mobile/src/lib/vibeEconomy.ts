import { supabase } from "./supabase";
import type { PointReason, PointTransaction, Shout, ZoneGuardian, Mute, DailyLoginResult, GhostModeState } from "../types/economy";

// ── Award points via edge function ──
export async function awardPoints(reason: PointReason): Promise<{ balance: number; awarded: number } | null> {
  const { data, error } = await supabase.functions.invoke("award-points", {
    body: { reason },
  });
  if (error || !data) return null;
  return data as { balance: number; awarded: number };
}

// ── Get vibe points balance ──
export async function getVibeBalance(userId: string): Promise<number> {
  const { data } = await supabase
    .from("profiles")
    .select("vibe_points")
    .eq("id", userId)
    .single();
  return data?.vibe_points ?? 0;
}

// ── Get point transaction history ──
export async function getTransactions(userId: string, limit = 20): Promise<PointTransaction[]> {
  const { data } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as PointTransaction[];
}

// ── Send a shout (broadcast message in a zone) ──
export async function sendShout(
  roomId: string,
  body: string,
  cost = 5,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase.rpc("send_shout", {
    _room_id: roomId,
    _sender: (await supabase.auth.getUser()).data.user?.id,
    _body: body,
    _cost: cost,
  });

  if (error) return { error: error.message };
  return { id: data as string };
}

// ── Fetch shouts for a room ──
export async function getRoomShouts(roomId: string, limit = 50): Promise<Shout[]> {
  const { data } = await supabase
    .from("shouts")
    .select("id, room_id, sender_id, body, cost, created_at, sender:profiles!sender_id(username, vibe)")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((s: any) => ({
    ...s,
    sender_username: s.sender?.username,
    sender_vibe: s.sender?.vibe,
  }));
}

// ── Check if user is a guardian in a room ──
export async function isGuardian(roomId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("zone_guardians")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ── Get all guardians for a room ──
export async function getRoomGuardians(roomId: string): Promise<ZoneGuardian[]> {
  const { data } = await supabase
    .from("zone_guardians")
    .select("*")
    .eq("room_id", roomId);
  return (data ?? []) as ZoneGuardian[];
}

// ── Mute a user in a room (guardian action) ──
export async function muteUser(
  roomId: string,
  targetUserId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase.from("mutes").insert({
    room_id: roomId,
    muted_user_id: targetUserId,
    muted_by: user.id,
    reason,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── Check if a user is currently muted in a room ──
export async function isUserMuted(roomId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("mutes")
    .select("id")
    .eq("room_id", roomId)
    .eq("muted_user_id", userId)
    .gte("expires_at", new Date().toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ── Claim daily login bonus (+10 points) ──
export async function claimDailyLogin(): Promise<DailyLoginResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { claimed: false, balance: 0, message: "Not authenticated" };

  const { data, error } = await supabase.rpc("claim_daily_login", {
    _user_id: user.id,
  });

  if (error) return { claimed: false, balance: 0, message: error.message };
  return data as DailyLoginResult;
}

// ── Activate ghost mode (-100 points, 30 min invisible) ──
export async function activateGhostMode(): Promise<{
  success: boolean;
  ghost_until?: string;
  balance?: number;
  error?: string;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("activate_ghost_mode", {
    _user_id: user.id,
  });

  if (error) return { success: false, error: error.message };
  return data as { success: boolean; ghost_until?: string; balance?: number; error?: string };
}

// ── Get ghost mode state ──
export async function getGhostModeState(userId: string): Promise<GhostModeState> {
  const { data } = await supabase
    .from("profiles")
    .select("ghost_mode_until")
    .eq("id", userId)
    .single();

  const until = data?.ghost_mode_until;
  if (!until) return { active: false, until: null, remainingMs: 0 };

  const remaining = new Date(until).getTime() - Date.now();
  return {
    active: remaining > 0,
    until,
    remainingMs: Math.max(0, remaining),
  };
}

// ── GPS-verified Safe Check-in (+50 points each) ──
export async function gpsCheckin(
  safeSpotId: string,
  partnerId: string,
  latitude: number,
  longitude: number,
): Promise<{
  success: boolean;
  checkin_id?: string;
  checkin_code?: string;
  points_awarded?: number;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("gps-checkin", {
    body: {
      safe_spot_id: safeSpotId,
      partner_id: partnerId,
      latitude,
      longitude,
    },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

// ── Generate QR badge token ──
export async function generateQrBadge(
  spotId: string,
): Promise<{ success: boolean; qr_payload?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { data, error } = await supabase.functions.invoke("verify-badge", {
    body: { action: "generate", user_id: user.id, spot_id: spotId },
  });

  if (error) return { success: false, error: error.message };
  return data;
}

// ── Verify QR badge (partner-side) ──
export async function verifyQrBadge(
  qrPayload: string,
): Promise<{
  valid: boolean;
  discount_pct?: number;
  points_awarded?: number;
  partner_name?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("verify-badge", {
    body: { action: "verify", qr_payload: qrPayload },
  });

  if (error) return { valid: false, error: error.message };
  return data;
}
