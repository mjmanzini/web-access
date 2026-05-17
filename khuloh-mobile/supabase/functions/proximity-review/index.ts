// Khuloh – Proximity Review Prompt Edge Function
// Called periodically (cron) to check confirmed pair check-ins
// where users have been co-located for > 1 hour, then creates
// pending review prompts for both users.

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find confirmed check-ins older than 1 hour that don't have pending reviews yet
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: checkins, error: fetchError } = await supabase
      .from("pair_checkins")
      .select("id, initiator_id, partner_id, confirmed_at")
      .eq("status", "confirmed")
      .lte("confirmed_at", oneHourAgo);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let promptsCreated = 0;

    for (const checkin of checkins ?? []) {
      // Create pending review prompts for both users (if not already existing)
      const { error: insertError } = await supabase
        .from("pending_reviews")
        .upsert([
          {
            user_id: checkin.initiator_id,
            other_user_id: checkin.partner_id,
            pair_checkin_id: checkin.id,
          },
          {
            user_id: checkin.partner_id,
            other_user_id: checkin.initiator_id,
            pair_checkin_id: checkin.id,
          },
        ], { onConflict: "user_id,other_user_id,pair_checkin_id" });

      if (!insertError) {
        promptsCreated += 2;
      }

      // Mark check-in as redeemed so it's not processed again
      await supabase
        .from("pair_checkins")
        .update({ status: "redeemed" })
        .eq("id", checkin.id);
    }

    return new Response(
      JSON.stringify({
        processed: (checkins ?? []).length,
        prompts_created: promptsCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
