import { supabase } from "./supabase";
import type { SafeSpot, PairCheckin, PendingReview, MeetupRating } from "../types/safespots";

// ── Fetch all active safe spots ──
export async function getSafeSpots(city?: string): Promise<SafeSpot[]> {
  let query = supabase
    .from("safe_spots")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (city) query = query.eq("city", city);

  const { data } = await query;
  return (data ?? []) as SafeSpot[];
}

// ── Get safe spots near a coordinate (simple bounding-box) ──
export async function getNearbySafeSpots(
  lat: number,
  lng: number,
  radiusKm = 10,
): Promise<SafeSpot[]> {
  // ~0.009 degrees per km
  const delta = radiusKm * 0.009;
  const { data } = await supabase
    .from("safe_spots")
    .select("*")
    .eq("is_active", true)
    .gte("latitude", lat - delta)
    .lte("latitude", lat + delta)
    .gte("longitude", lng - delta)
    .lte("longitude", lng + delta);
  return (data ?? []) as SafeSpot[];
}

// ── Initiate a pair check-in ──
export async function initiatePairCheckin(
  safeSpotId: string,
  partnerId: string,
): Promise<PairCheckin | { error: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase
    .from("pair_checkins")
    .insert({
      safe_spot_id: safeSpotId,
      initiator_id: user.id,
      partner_id: partnerId,
    })
    .select("*")
    .single();

  if (error) return { error: error.message };
  return data as PairCheckin;
}

// ── Confirm a pair check-in (partner enters the code) ──
export async function confirmPairCheckin(
  checkinId: string,
  code: string,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase.rpc("confirm_pair_checkin", {
    _checkin_id: checkinId,
    _confirmer: user.id,
    _code: code,
  });

  if (error) return false;
  return data as boolean;
}

// ── Get user's check-in history ──
export async function getMyCheckins(): Promise<PairCheckin[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("pair_checkins")
    .select("*, spot:safe_spots!safe_spot_id(name), partner:profiles!partner_id(username)")
    .or(`initiator_id.eq.${user.id},partner_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(20);

  return (data ?? []).map((c: any) => ({
    ...c,
    spot_name: c.spot?.name,
    partner_username: c.partner?.username,
  }));
}

// ── Get pending reviews for current user ──
export async function getPendingReviews(): Promise<PendingReview[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("pending_reviews")
    .select("*, other:profiles!other_user_id(username)")
    .eq("user_id", user.id)
    .eq("reviewed", false)
    .order("prompted_at", { ascending: false });

  return (data ?? []).map((r: any) => ({
    ...r,
    other_username: r.other?.username,
  }));
}

// ── Submit a post-meetup review ──
export async function submitReview(
  reviewedId: string,
  rating: MeetupRating,
  comment = "",
  checkinId?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase.rpc("submit_meetup_review", {
    _reviewer: user.id,
    _reviewed: reviewedId,
    _rating: rating,
    _comment: comment,
    _checkin_id: checkinId ?? null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── Toggle data-light mode ──
export async function setDataLightMode(enabled: boolean): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("profiles")
    .update({ data_light_mode: enabled })
    .eq("id", user.id);

  return !error;
}
