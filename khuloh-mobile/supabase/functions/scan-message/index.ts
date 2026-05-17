// Khuloh – Scam Scanner Edge Function
// Scans messages for high-risk scam patterns common in SA,
// flags them in message_flags, and returns scan result to client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── High-risk patterns (case-insensitive) ──────────────────
// Each has a regex and a human-readable reason for flagging.
const SCAM_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Airtime / data scams
  { pattern: /send\s*(me\s*)?(some\s*)?airtime/i, reason: "Airtime request" },
  { pattern: /buy\s*(me\s*)?(some\s*)?data/i, reason: "Data request" },
  { pattern: /airtime\s*pin/i, reason: "Airtime pin solicitation" },
  { pattern: /recharge\s*voucher/i, reason: "Voucher solicitation" },

  // Money transfer scams
  { pattern: /e[\s-]?wallet/i, reason: "E-wallet reference" },
  { pattern: /send\s*(me\s*)?(some\s*)?money/i, reason: "Money request" },
  { pattern: /cash\s*send/i, reason: "CashSend request" },
  { pattern: /eft\s*(me|transfer)/i, reason: "EFT request" },
  { pattern: /bank\s*(details|account|number)/i, reason: "Bank details solicitation" },
  { pattern: /proof\s*of\s*payment/i, reason: "Payment proof scheme" },
  { pattern: /deposit\s*(into|to)\s*(my|this)/i, reason: "Deposit request" },

  // Urgency / pressure tactics
  { pattern: /whatsapp\s*me\s*(immediately|now|urgently|asap)/i, reason: "Urgent off-platform redirect" },
  { pattern: /call\s*me\s*(immediately|now|urgently|asap)/i, reason: "Urgent off-platform redirect" },
  { pattern: /this\s*is\s*(very\s*)?urgent/i, reason: "Urgency pressure tactic" },
  { pattern: /limited\s*time\s*(only|offer)/i, reason: "Urgency pressure tactic" },

  // Off-platform luring
  { pattern: /whatsapp\s*me\s*(on|at)?\s*\+?\d/i, reason: "Off-platform number sharing" },
  { pattern: /add\s*me\s*(on\s*)?whatsapp/i, reason: "Off-platform redirect" },
  { pattern: /telegram\s*(me|link|group)/i, reason: "Off-platform redirect" },
  { pattern: /click\s*(this|the)\s*(link|url)/i, reason: "Suspicious link sharing" },

  // Investment / pyramid scams
  { pattern: /invest(ment)?\s*opportunity/i, reason: "Investment scam indicator" },
  { pattern: /forex\s*(trading|signal)/i, reason: "Forex scam indicator" },
  { pattern: /bitcoin\s*(invest|trading|opportunity)/i, reason: "Crypto scam indicator" },
  { pattern: /double\s*your\s*money/i, reason: "Ponzi scheme indicator" },
  { pattern: /guaranteed\s*(returns?|profit)/i, reason: "Guaranteed returns scam" },
  { pattern: /stokvel.*join/i, reason: "Suspicious stokvel recruitment" },

  // Identity theft
  { pattern: /id\s*number/i, reason: "ID number solicitation" },
  { pattern: /id\s*document/i, reason: "ID document solicitation" },
  { pattern: /send\s*(me\s*)?(your\s*)?pin/i, reason: "PIN solicitation" },
  { pattern: /otp\s*(code|number)/i, reason: "OTP solicitation" },

  // Blackmail / sextortion
  { pattern: /i\s*(will|ll)\s*(send|share|post)\s*(your\s*)?(pics?|photos?|nudes?|video)/i, reason: "Sextortion threat" },
  { pattern: /pay\s*(me\s*)?or\s*(i\s*)?(will|ll)/i, reason: "Blackmail threat" },
];

/**
 * Scan a message body against all known scam patterns.
 * Returns array of matches (empty = clean).
 */
function scanMessage(body: string): { pattern: string; reason: string }[] {
  const matches: { pattern: string; reason: string }[] = [];
  for (const { pattern, reason } of SCAM_PATTERNS) {
    if (pattern.test(body)) {
      matches.push({ pattern: pattern.source, reason });
    }
  }
  return matches;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Authenticate ──────────────────────────────
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

    // ── 2. Validate body ─────────────────────────────
    const { body, message_type, message_id } = await req.json();

    if (!body || typeof body !== "string") {
      return new Response(
        JSON.stringify({ error: "body is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!message_type || !["zone", "whisper"].includes(message_type)) {
      return new Response(
        JSON.stringify({ error: "message_type must be 'zone' or 'whisper'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!message_id || typeof message_id !== "string") {
      return new Response(
        JSON.stringify({ error: "message_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Scan the message ──────────────────────────
    const flags = scanMessage(body);

    // ── 4. Record flags using service role ───────────
    if (flags.length > 0) {
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);

      const flagRows = flags.map((f) => ({
        message_type,
        message_id,
        flagged_user: user.id,
        reason: f.reason,
        pattern: f.pattern,
        source: "ai" as const,
      }));

      await adminClient.from("message_flags").insert(flagRows);
    }

    // ── 5. Return result ─────────────────────────────
    return new Response(
      JSON.stringify({
        flagged: flags.length > 0,
        flags: flags.map((f) => f.reason),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
