// QR Badge Verification Edge Function
// Partner businesses scan QR at till → verify trust badge → apply discount + points
// QR payload contains a signed token with user ID and spot ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QR_SECRET = Deno.env.get("QR_BADGE_SECRET") || "khuloh-badge-2024";

// Simple HMAC-like token verification (production: use proper JWT)
function verifyQrToken(payload: string): { userId: string; spotId: string } | null {
  try {
    // Format: base64(userId:spotId:timestamp:signature)
    const decoded = atob(payload);
    const parts = decoded.split(":");
    if (parts.length < 4) return null;

    const [userId, spotId, timestamp, signature] = parts;

    // Verify timestamp (valid for 24 hours)
    const ts = parseInt(timestamp, 10);
    const now = Date.now();
    if (now - ts > 24 * 60 * 60 * 1000) return null;

    // Verify signature
    const expected = btoa(`${userId}:${spotId}:${timestamp}:${QR_SECRET}`).slice(0, 16);
    if (signature !== expected) return null;

    return { userId, spotId };
  } catch {
    return null;
  }
}

// Generate a QR token for a user at a specific spot
function generateQrToken(userId: string, spotId: string): string {
  const timestamp = Date.now().toString();
  const signature = btoa(`${userId}:${spotId}:${timestamp}:${QR_SECRET}`).slice(0, 16);
  return btoa(`${userId}:${spotId}:${timestamp}:${signature}`);
}

Deno.serve(async (req) => {
  try {
    const { action, qr_payload, user_id, spot_id } = await req.json();

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Generate QR token (called from app) ──
    if (action === "generate") {
      if (!user_id || !spot_id) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing user_id or spot_id" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Verify user is verified and has sufficient trust
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, trust_score, is_verified, username")
        .eq("id", user_id)
        .single();

      if (!profile?.is_verified) {
        return new Response(
          JSON.stringify({ success: false, error: "User not verified" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (profile.trust_score < 50) {
        return new Response(
          JSON.stringify({ success: false, error: "Trust score too low (minimum 50)" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const token = generateQrToken(user_id, spot_id);

      return new Response(
        JSON.stringify({
          success: true,
          qr_payload: token,
          trust_score: profile.trust_score,
          username: profile.username,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Verify QR badge (called at till by partner) ──
    if (action === "verify") {
      if (!qr_payload) {
        return new Response(
          JSON.stringify({ valid: false, error: "Missing qr_payload" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const parsed = verifyQrToken(qr_payload);
      if (!parsed) {
        return new Response(
          JSON.stringify({ valid: false, error: "Invalid or expired QR code" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Fetch user and spot details
      const [{ data: profile }, { data: spot }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, username, trust_score, is_verified, vibe_points")
          .eq("id", parsed.userId)
          .single(),
        supabase
          .from("safe_spots")
          .select("id, name, discount_pct")
          .eq("id", parsed.spotId)
          .eq("is_active", true)
          .single(),
      ]);

      if (!profile?.is_verified) {
        return new Response(
          JSON.stringify({ valid: false, error: "User not verified" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!spot) {
        return new Response(
          JSON.stringify({ valid: false, error: "Safe-Spot not found or inactive" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Prevent duplicate badge scans within 4 hours
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("trust_badges")
        .select("id")
        .eq("user_id", parsed.userId)
        .eq("partner_spot_id", parsed.spotId)
        .gte("verified_at", fourHoursAgo)
        .limit(1);

      if (recent && recent.length > 0) {
        return new Response(
          JSON.stringify({
            valid: true,
            discount_pct: spot.discount_pct,
            points_awarded: 0,
            partner_name: spot.name,
            username: profile.username,
            message: "Badge already redeemed recently",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Award +25 points for badge verification
      const badgePoints = 25;
      await supabase.rpc("award_vibe_points", {
        _user_id: parsed.userId,
        _reason: "checkin_complete",
        _amount: badgePoints,
      });

      // Record the badge scan
      await supabase.from("trust_badges").insert({
        user_id: parsed.userId,
        partner_spot_id: parsed.spotId,
        qr_token: qr_payload,
        discount_pct: spot.discount_pct,
        points_awarded: badgePoints,
      });

      return new Response(
        JSON.stringify({
          valid: true,
          discount_pct: spot.discount_pct,
          points_awarded: badgePoints,
          partner_name: spot.name,
          username: profile.username,
          trust_score: profile.trust_score,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use "generate" or "verify"' }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
