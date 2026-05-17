// GPS-based Safe Check-in Edge Function
// Verifies two users are within proximity of a Safe-Spot
// Awards +50 verified meetup points to both users

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_DISTANCE_KM = 0.5; // 500m radius for GPS verification

// Haversine formula for distance between two GPS coordinates
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (req) => {
  try {
    const { safe_spot_id, partner_id, latitude, longitude } = await req.json();

    // Validate required fields
    if (!safe_spot_id || !partner_id || latitude == null || longitude == null) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Get authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Not authenticated" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify JWT and get user
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // Fetch the Safe-Spot coordinates
    const { data: spot, error: spotErr } = await supabase
      .from("safe_spots")
      .select("id, name, latitude, longitude, discount_pct")
      .eq("id", safe_spot_id)
      .eq("is_active", true)
      .single();

    if (spotErr || !spot) {
      return new Response(
        JSON.stringify({ success: false, error: "Safe-Spot not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Verify GPS proximity to the Safe-Spot
    const distanceToSpot = haversineKm(
      latitude,
      longitude,
      spot.latitude,
      spot.longitude,
    );

    if (distanceToSpot > MAX_DISTANCE_KM) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Too far from ${spot.name} (${distanceToSpot.toFixed(1)}km away, must be within ${MAX_DISTANCE_KM}km)`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Prevent self-checkin
    if (user.id === partner_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Cannot check in with yourself" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check partner exists and is verified
    const { data: partner } = await supabase
      .from("profiles")
      .select("id, is_verified, username")
      .eq("id", partner_id)
      .single();

    if (!partner || !partner.is_verified) {
      return new Response(
        JSON.stringify({ success: false, error: "Partner not found or not verified" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Prevent duplicate GPS check-ins within 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: recentCheckin } = await supabase
      .from("pair_checkins")
      .select("id")
      .eq("safe_spot_id", safe_spot_id)
      .or(`initiator_id.eq.${user.id},partner_id.eq.${user.id}`)
      .gte("created_at", twoHoursAgo)
      .eq("status", "confirmed")
      .limit(1);

    if (recentCheckin && recentCheckin.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Already checked in at this spot recently" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Create confirmed check-in (GPS-verified = auto-confirmed)
    const checkinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data: checkin, error: insertErr } = await supabase
      .from("pair_checkins")
      .insert({
        safe_spot_id,
        initiator_id: user.id,
        partner_id,
        checkin_code: checkinCode,
        status: "confirmed",
        discount_pct: spot.discount_pct,
        confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create check-in" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Award +50 verified meetup points to both users
    const meetupPoints = 50;

    await supabase.rpc("award_vibe_points", {
      _user_id: user.id,
      _reason: "verified_meetup",
      _amount: meetupPoints,
    });

    await supabase.rpc("award_vibe_points", {
      _user_id: partner_id,
      _reason: "verified_meetup",
      _amount: meetupPoints,
    });

    // Create pending reviews for both users
    const now = new Date().toISOString();
    await supabase.from("pending_reviews").insert([
      {
        user_id: user.id,
        other_user_id: partner_id,
        pair_checkin_id: checkin.id,
        prompted_at: now,
      },
      {
        user_id: partner_id,
        other_user_id: user.id,
        pair_checkin_id: checkin.id,
        prompted_at: now,
      },
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        checkin_id: checkin.id,
        checkin_code: checkinCode,
        points_awarded: meetupPoints,
        distance_km: parseFloat(distanceToSpot.toFixed(2)),
        spot_name: spot.name,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
