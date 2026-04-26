import crypto from 'node:crypto';

/**
 * Build the WebRTC ICE server list from env.
 *
 * STUN:
 *   STUN_URLS="stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
 *
 * TURN (static long-term credentials — simplest, fine for dev):
 *   TURN_URL="turn:turn.example.com:3478"
 *   TURN_USERNAME="webaccess"
 *   TURN_PASSWORD="s3cret"
 *
 * TURN (time-limited REST credentials — recommended for prod, RFC 5766-TURN-REST
 * style used by coturn's `use-auth-secret` / `static-auth-secret`):
 *   TURN_URL="turn:turn.example.com:3478,turns:turn.example.com:5349"
 *   TURN_SHARED_SECRET="shared-with-coturn"
 *   TURN_TTL_SECONDS="86400"   # optional, default 24h
 *
 * If both TURN_PASSWORD and TURN_SHARED_SECRET are set, REST wins.
 */
export function buildIceServers() {
  const servers = [];

  const stunList = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (stunList.length) servers.push({ urls: stunList });

  const turnUrls = (process.env.TURN_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (turnUrls.length) {
    const ttl = Number(process.env.TURN_TTL_SECONDS || 86400);

    if (process.env.TURN_SHARED_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + ttl}:webaccess`;
      const credential = crypto
        .createHmac('sha1', process.env.TURN_SHARED_SECRET)
        .update(username)
        .digest('base64');
      servers.push({ urls: turnUrls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
      servers.push({
        urls: turnUrls,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_PASSWORD,
      });
    } else {
      // Misconfigured: a TURN URL with no credentials. Omit it to avoid client errors.
      // eslint-disable-next-line no-console
      console.warn('[signaling] TURN_URL set but no credentials (TURN_PASSWORD or TURN_SHARED_SECRET); skipping TURN.');
    }
  }

  return servers;
}
