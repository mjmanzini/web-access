// Khuloh – Re-Verification Trigger Edge Function
// Called periodically to process users flagged for re-verification.
// Sends a notification and resets their verification status.

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

    // Find users who need re-verification
    const { data: users, error: fetchError } = await supabase
      .from("profiles")
      .select("id, username, phone, trust_score")
      .eq("reverify_required", true)
      .eq("is_verified", false);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const processed: string[] = [];

    for (const user of users ?? []) {
      // Reduce trust score as penalty
      await supabase
        .from("profiles")
        .update({
          trust_score: Math.max(0, user.trust_score - 15),
        })
        .eq("id", user.id);

      processed.push(user.id);
    }

    return new Response(
      JSON.stringify({
        processed: processed.length,
        user_ids: processed,
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
