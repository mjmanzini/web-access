// Khuloh – Award Vibe Points Edge Function
// Server-side point awarding with validation.
// Called by the client to award points for specific actions.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const POINT_VALUES: Record<string, number> = {
  bio_complete: 10,
  safe_date_review: 15,
  scammer_reported: 20,
  checkin_complete: 5,
  guardian_bonus: 10,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify the calling user
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { reason } = await req.json();

    // Validate reason
    if (!reason || !POINT_VALUES[reason]) {
      return new Response(
        JSON.stringify({ error: "Invalid reason" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const amount = POINT_VALUES[reason];

    // Prevent duplicate awards for one-time actions
    if (reason === "bio_complete") {
      const { data: existing } = await supabase
        .from("point_transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("reason", "bio_complete")
        .limit(1);

      if (existing && existing.length > 0) {
        // Already awarded — return current balance without error
        const { data: profile } = await supabase
          .from("profiles")
          .select("vibe_points")
          .eq("id", user.id)
          .single();

        return new Response(
          JSON.stringify({ balance: profile?.vibe_points ?? 0, already_awarded: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Award points via the DB function
    const { data: newBalance, error: rpcError } = await supabase
      .rpc("award_vibe_points", {
        _user_id: user.id,
        _amount: amount,
        _reason: reason,
      });

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ balance: newBalance, awarded: amount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
