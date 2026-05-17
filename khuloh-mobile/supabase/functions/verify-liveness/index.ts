// Khuloh – Liveness Verification Edge Function (Simulated)
// Validates JWT, accepts a base64 image, simulates AI processing,
// and sets is_verified = true on the user's profile via service_role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- 1. Authenticate the caller ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the user's JWT using the anon client
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await anonClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 2. Validate request body ---
    const { image_base64 } = await req.json();

    if (!image_base64 || typeof image_base64 !== "string" || image_base64.length < 100) {
      return new Response(
        JSON.stringify({ error: "image_base64 is required and must be a non-trivial base64 string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 3. Simulate AI liveness detection (placeholder) ---
    // In production, replace this block with a call to:
    //   - AWS Rekognition DetectFaces / CompareFaces
    //   - Azure Face API Liveness Detection
    //   - A custom ML model endpoint
    await new Promise((resolve) => setTimeout(resolve, 500));

    const match = true;
    const confidence = 0.97;

    // --- 4. On match, flip is_verified using service_role (bypasses RLS) ---
    if (match) {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { error: updateError } = await adminClient
        .from("profiles")
        .update({ is_verified: true })
        .eq("id", user.id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "Failed to update verification status" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // --- 5. Return result ---
    return new Response(
      JSON.stringify({ match, confidence }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
