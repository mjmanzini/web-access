/**
 * khuloh/scam-shield.js — lightweight NLP filter for scam / off-platform-pivot
 * messages. Phase 6 of the Khuloh plan.
 *
 * Designed to run synchronously on every outbound chat message before fan-out.
 * No external services, no PII leaves the process. Patterns are tuned for
 * the South African scam landscape (airtime, e-wallet, "send R…").
 *
 * Returns one of three actions:
 *   'allow'    — clean
 *   'flag'     — deliver but log + bump strike counter
 *   'block'    — do not deliver; sender gets a friendly nudge
 *
 * The patterns deliberately err on the side of false positives for
 * money-solicitation, since that is the #1 abuse vector reported by users.
 */

const HIGH_RISK = [
  // Direct money / value transfer asks
  /\bsend (?:me )?(?:r\s?\d|airtime|data\s?bundle|vouchers?|cash|money|crypto|btc|usdt)\b/i,
  /\bairtime\s+(?:please|asap|now|to)\b/i,
  /\b(?:e[- ]?wallet|capitec|fnb|absa|nedbank|tymebank|standard\s*bank)\b.*\b(?:send|transfer|deposit|pay)\b/i,
  /\b(?:send|transfer|deposit|eft|swipe)\b.*\b(?:e[- ]?wallet|capitec|fnb|absa|nedbank|tymebank)\b/i,
  /\binvest(?:ment)?\s+(?:opportunity|guaranteed|return|forex|crypto)\b/i,
  /\b(?:sugar\s*(?:daddy|mommy)|allowance)\b/i,
  /\b(?:mukando|stokvel)\b.*\b(?:join|deposit)\b/i,

  // Off-platform pivot before any rapport (commonly used by bots)
  /\bwhats?app\s*(?:me|number|no\.?)\b/i,
  /\b(?:my\s*)?whats?app\s*(?:is|:)?\s*(?:\+?27|0)\d{9}\b/,
  /\btelegram\s*(?:me|@|username)\b/i,
  /\bdm\s+me\s+on\s+(?:ig|insta|instagram|snap|telegram)\b/i,
];

const MEDIUM_RISK = [
  /\b(?:please|pls|plz)\s+(?:help|sponsor|support)\s+(?:me|us)\b/i,
  /\bmy\s+(?:bank|account)\s+(?:number|details)\b/i,
  /\bcash\s*app\b/i,
  /\bgift\s*cards?\b/i,
  /\bvoucher\s*code\b/i,
  /\bclick\s+this\s+link\b/i,
  /https?:\/\/(?:bit\.ly|tinyurl\.com|goo\.gl|t\.me)\b/i,
];

/**
 * @param {string} text
 * @returns {{ action: 'allow'|'flag'|'block', reasons: string[] }}
 */
export function evaluateMessage(text) {
  const body = String(text || '');
  if (!body.trim()) return { action: 'allow', reasons: [] };

  const reasons = [];
  for (const re of HIGH_RISK) {
    if (re.test(body)) reasons.push(`high:${re.source.slice(0, 60)}`);
  }
  if (reasons.length) return { action: 'block', reasons };

  for (const re of MEDIUM_RISK) {
    if (re.test(body)) reasons.push(`med:${re.source.slice(0, 60)}`);
  }
  if (reasons.length) return { action: 'flag', reasons };

  return { action: 'allow', reasons: [] };
}

const FRIENDLY_BLOCK = (
  'Khuloh blocked this message. Asking for airtime, money, bank details, ' +
  'or to move chats off-platform is not allowed. Repeated attempts will ' +
  'restrict your account.'
);

export function buildBlockNotice() {
  return FRIENDLY_BLOCK;
}
