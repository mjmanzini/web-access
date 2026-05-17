// Khuloh – Safety Check-in Edge Function
// Cron-triggered: finds overdue check-ins and alerts emergency contacts.
// In production, integrate with an SMS gateway (e.g., Twilio, Africa's Talking).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── 1. Get overdue check-ins with emergency contacts ──
    const { data: overdue, error: queryError } = await adminClient.rpc(
      "get_overdue_checkins",
    );

    if (queryError || !overdue || overdue.length === 0) {
      return new Response(
        JSON.stringify({ alerted: 0, message: "No overdue check-ins" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Group by check-in to avoid duplicate alerts ──
    const checkinMap = new Map<
      string,
      { user_id: string; met_user_id: string; lat: number | null; lng: number | null; contacts: { name: string; phone: string }[] }
    >();

    for (const row of overdue) {
      if (!checkinMap.has(row.checkin_id)) {
        checkinMap.set(row.checkin_id, {
          user_id: row.user_id,
          met_user_id: row.met_user_id,
          lat: row.latitude,
          lng: row.longitude,
          contacts: [],
        });
      }
      checkinMap.get(row.checkin_id)!.contacts.push({
        name: row.contact_name,
        phone: row.contact_phone,
      });
    }

    // ── 3. Send alerts (placeholder – integrate SMS gateway) ──
    let alertCount = 0;
    for (const [checkinId, info] of checkinMap) {
      for (const contact of info.contacts) {
        // In production, send SMS:
        // await sendSMS(contact.phone, `Safety alert: your contact ... has not checked in.`);
        console.log(
          `[ALERT] Checkin ${checkinId}: Notify ${contact.name} (${contact.phone}) ` +
          `about user ${info.user_id} who met ${info.met_user_id} ` +
          `at ${info.lat ?? "?"}, ${info.lng ?? "?"}`,
        );
        alertCount++;
      }
    }

    // ── 4. Mark check-ins as alerted ──────────────────
    const checkinIds = Array.from(checkinMap.keys());
    await adminClient.rpc("mark_checkins_alerted", {
      checkin_ids: checkinIds,
    });

    return new Response(
      JSON.stringify({ alerted: alertCount, checkins: checkinIds.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
