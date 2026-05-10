import nodemailer from 'nodemailer';

let transport;

function smtpPort() {
  const raw = Number(process.env.SMTP_PORT || 587);
  return Number.isFinite(raw) && raw > 0 ? raw : 587;
}

function smtpSecure() {
  const explicit = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return smtpPort() === 465;
}

function mailConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  if (!host || !from) return null;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  return {
    host,
    port: smtpPort(),
    secure: smtpSecure(),
    from,
    replyTo: String(process.env.SMTP_REPLY_TO || from).trim(),
    auth: user && pass ? { user, pass } : undefined,
  };
}

function getTransport() {
  const config = mailConfig();
  if (!config) return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }
  return { transport, config };
}

export async function sendContactInviteEmail({ to, inviteeName, inviterName, inviteUrl }) {
  const mailer = getTransport();
  if (!mailer) throw new Error('smtp_not_configured');

  const safeInvitee = String(inviteeName || 'there').trim() || 'there';
  const safeInviter = String(inviterName || 'A contact').trim() || 'A contact';
  const safeUrl = String(inviteUrl || '').trim();

  await mailer.transport.sendMail({
    from: mailer.config.from,
    replyTo: mailer.config.replyTo,
    to,
    subject: `${safeInviter} invited you to Web-Access`,
    text: [
      `Hi ${safeInvitee},`,
      '',
      `${safeInviter} invited you to connect on Web-Access.`,
      'Open the link below to register and start chatting:',
      safeUrl,
      '',
      'If you were not expecting this invite, you can ignore this email.',
    ].join('\n'),
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;color:#111b21;line-height:1.5;max-width:560px">
        <p>Hi ${escapeHtml(safeInvitee)},</p>
        <p><strong>${escapeHtml(safeInviter)}</strong> invited you to connect on Web-Access.</p>
        <p>
          <a href="${escapeAttribute(safeUrl)}" style="display:inline-block;padding:12px 18px;background:#00a884;color:#061512;text-decoration:none;border-radius:8px;font-weight:700">
            Open invite
          </a>
        </p>
        <p style="word-break:break-word;color:#667781">${escapeHtml(safeUrl)}</p>
        <p style="color:#667781">If you were not expecting this invite, you can ignore this email.</p>
      </div>
    `,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}