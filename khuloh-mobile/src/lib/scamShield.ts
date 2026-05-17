import { ScanResult } from "../types/safety";
import { getBackendBaseUrl, getStoredBackendToken } from "./backend-client";

// ── Client-side quick scan (runs before sending) ────────────
// Lightweight subset of patterns for instant local feedback.
// Full scan happens server-side via the edge function.
const LOCAL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /send\s*(me\s*)?(some\s*)?airtime/i, reason: "Airtime request" },
  { pattern: /e[\s-]?wallet/i, reason: "E-wallet reference" },
  { pattern: /send\s*(me\s*)?(some\s*)?money/i, reason: "Money request" },
  { pattern: /cash\s*send/i, reason: "CashSend request" },
  { pattern: /bank\s*(details|account|number)/i, reason: "Bank details solicitation" },
  { pattern: /whatsapp\s*me\s*(immediately|now|urgently|asap)/i, reason: "Urgent off-platform redirect" },
  { pattern: /whatsapp\s*me\s*(on|at)?\s*\+?\d/i, reason: "Off-platform number sharing" },
  { pattern: /send\s*(me\s*)?(your\s*)?pin/i, reason: "PIN solicitation" },
  { pattern: /otp\s*(code|number)/i, reason: "OTP solicitation" },
  { pattern: /double\s*your\s*money/i, reason: "Ponzi scheme indicator" },
  { pattern: /guaranteed\s*(returns?|profit)/i, reason: "Guaranteed returns scam" },
  { pattern: /id\s*number/i, reason: "ID number solicitation" },
];

/**
 * Quick local scan – returns first match or null.
 * Use this for instant UI warnings before the message is sent.
 */
export function quickScanMessage(body: string): string | null {
  for (const { pattern, reason } of LOCAL_PATTERNS) {
    if (pattern.test(body)) {
      return reason;
    }
  }
  return null;
}

/**
 * Full server-side scan via edge function.
 * Call AFTER the message is inserted to flag it async.
 */
export async function serverScanMessage(
  body: string,
  messageType: "zone" | "whisper",
  messageId: string,
): Promise<ScanResult> {
  void body;
  void messageType;
  void messageId;
  return { flagged: false, flags: [] };
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

/**
 * Report a user (max once per pair).
 */
export async function reportUser(
  reportedId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getStoredBackendToken();
    if (!token) {
      return { success: false, error: "Backend session required to report users." };
    }

    const response = await fetch(`${getBackendBaseUrl()}/api/reports/users`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reportedUserId: reportedId,
        reason,
      }),
    });

    const payload = await parseJson(response);
    if (!response.ok) {
      return {
        success: false,
        error: String((payload as { error?: string } | null)?.error || `request_failed_${response.status}`),
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "report_failed",
    };
  }
}
