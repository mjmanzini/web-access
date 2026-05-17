/**
 * khuloh/sms.js — Pluggable SMS adapter for panic fan-out.
 *
 * Drivers (selected by SMS_PROVIDER env):
 *   - 'twilio'      → Twilio REST API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM)
 *   - 'clickatell'  → Clickatell One API (CLICKATELL_API_KEY)
 *   - 'log' (default when unset) → log only, returns { sent:false, reason:'sms_not_configured' }
 *
 * Always succeeds (returns { sent, provider, error? }) — never throws,
 * so panic fan-out is best-effort and won't crash a request.
 */

function provider() {
  return String(process.env.SMS_PROVIDER || 'log').toLowerCase();
}

function normPhone(raw) {
  const s = String(raw || '').replace(/\s+/g, '');
  if (!s) return null;
  // SA local 0xxxxxxxxx → +27xxxxxxxxx
  if (/^0\d{9}$/.test(s)) return `+27${s.slice(1)}`;
  if (/^\+\d{8,15}$/.test(s)) return s;
  return s;
}

async function sendTwilio({ to, body }) {
  const sid  = process.env.TWILIO_ACCOUNT_SID;
  const tok  = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !tok || !from) return { sent: false, provider: 'twilio', error: 'twilio_not_configured' };
  const auth = Buffer.from(`${sid}:${tok}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { sent: false, provider: 'twilio', error: `twilio_${res.status}: ${txt.slice(0, 200)}` };
  }
  return { sent: true, provider: 'twilio' };
}

async function sendClickatell({ to, body }) {
  const key = process.env.CLICKATELL_API_KEY;
  if (!key) return { sent: false, provider: 'clickatell', error: 'clickatell_not_configured' };
  const res = await fetch('https://platform.clickatell.com/messages', {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ messages: [{ channel: 'sms', to, content: body }] }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { sent: false, provider: 'clickatell', error: `clickatell_${res.status}: ${txt.slice(0, 200)}` };
  }
  return { sent: true, provider: 'clickatell' };
}

export async function sendSms({ to, body }) {
  const dest = normPhone(to);
  if (!dest) return { sent: false, provider: provider(), error: 'invalid_to' };
  const text = String(body || '').slice(0, 480);
  try {
    switch (provider()) {
      case 'twilio':     return await sendTwilio({ to: dest, body: text });
      case 'clickatell': return await sendClickatell({ to: dest, body: text });
      default:           return { sent: false, provider: 'log', error: 'sms_not_configured' };
    }
  } catch (err) {
    return { sent: false, provider: provider(), error: err.message };
  }
}
