/**
 * khuloh/partner-qr.js — Phase 7. Signed Safe-Spot QR codes.
 *
 * A partner displays a QR at the venue. The QR encodes:
 *   khuloh://safe-spot?d=<base64url(payload)>.<base64url(hmac)>
 *
 * Payload (JSON): { spot_id, exp, nonce }
 * HMAC: HMAC-SHA256(payload, KHULOH_QR_SIGNING_KEY)
 *
 * On scan, the client POSTs the encoded `d` to `/api/khuloh/partner/qr/verify`
 * with their current GPS. Server verifies HMAC + expiry + GPS-within-100m and,
 * if there's an in-progress meetup at the spot, marks the scanner as
 * checked-in. Also returns the spot's deal_text so the UI can show it.
 *
 * REST:
 *   GET   /api/khuloh/partner/qr?spotId=...&ttlMin=10   (admin: X-Khuloh-Admin-Key)
 *   POST  /api/khuloh/partner/qr/verify                 (auth) { token, lat, lng, meetupId? }
 */
import crypto from 'node:crypto';
import { getSafeSpot, safeSpotMath } from './safe-spots.js';
import { checkIn } from './meetups.js';

const CHECKIN_RADIUS_KM = 0.1;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signingKey() {
  const k = process.env.KHULOH_QR_SIGNING_KEY;
  if (!k || k.length < 16) return null;
  return Buffer.from(k, 'utf8');
}

export function issueQrToken({ spotId, ttlSec = 600 }) {
  if (!spotId) throw new Error('spot_required');
  const key = signingKey();
  if (!key) throw new Error('qr_signing_key_missing');
  const payload = {
    spot_id: spotId,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, Math.min(ttlSec, 86400)),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const pBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig  = crypto.createHmac('sha256', key).update(pBuf).digest();
  return `${b64url(pBuf)}.${b64url(sig)}`;
}

export function verifyQrToken(token) {
  const key = signingKey();
  if (!key) throw Object.assign(new Error('qr_signing_key_missing'), { code: 'qr_unavailable' });
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw Object.assign(new Error('malformed_token'), { code: 'bad_token' });
  const pBuf = b64urlDecode(parts[0]);
  const sig  = b64urlDecode(parts[1]);
  const expected = crypto.createHmac('sha256', key).update(pBuf).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    throw Object.assign(new Error('bad_signature'), { code: 'bad_signature' });
  }
  let payload;
  try { payload = JSON.parse(pBuf.toString('utf8')); } catch {
    throw Object.assign(new Error('bad_payload'), { code: 'bad_payload' });
  }
  if (!payload.spot_id || typeof payload.exp !== 'number') {
    throw Object.assign(new Error('bad_payload'), { code: 'bad_payload' });
  }
  if (Math.floor(Date.now() / 1000) > payload.exp) {
    throw Object.assign(new Error('expired'), { code: 'expired' });
  }
  return payload;
}

function checkAdmin(req) {
  const expected = process.env.KHULOH_ADMIN_KEY;
  if (!expected) return false;
  return req.header('x-khuloh-admin-key') === expected;
}

export function attachPartnerQrRoutes(app, requireAuth) {
  app.get('/api/khuloh/partner/qr', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'admin_key_required' });
    try {
      const spotId = String(req.query.spotId || '');
      const ttlMin = Number(req.query.ttlMin || 10);
      const spot = await getSafeSpot(spotId);
      if (!spot) return res.status(404).json({ error: 'spot_not_found' });
      const token = issueQrToken({ spotId, ttlSec: ttlMin * 60 });
      res.json({
        token,
        url: `khuloh://safe-spot?d=${encodeURIComponent(token)}`,
        spot: { id: spot.id, name: spot.name, city: spot.city },
        exp_sec: ttlMin * 60,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/khuloh/partner/qr/verify', requireAuth, async (req, res) => {
    try {
      const { token, lat, lng, meetupId } = req.body || {};
      const payload = verifyQrToken(token);
      const spot = await getSafeSpot(payload.spot_id);
      if (!spot || !spot.active) return res.status(404).json({ error: 'spot_inactive' });

      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return res.status(400).json({ error: 'coords_required' });
      }
      const distance = safeSpotMath.haversineKm({ lat: Number(lat), lng: Number(lng) }, spot);
      if (distance > CHECKIN_RADIUS_KM) {
        return res.status(409).json({ error: 'too_far_from_spot', distance_km: distance });
      }

      let meetup = null;
      if (meetupId) {
        try {
          meetup = await checkIn({ meetupId, uid: req.user.id, lat, lng });
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }

      res.json({
        ok: true,
        spot: {
          id: spot.id, name: spot.name, city: spot.city,
          deal_text: spot.deal_text || null,
        },
        meetup,
      });
    } catch (err) {
      const status = err.code === 'expired' ? 410
        : err.code === 'bad_signature' || err.code === 'bad_token' || err.code === 'bad_payload' ? 400
        : err.code === 'qr_unavailable' ? 503
        : 400;
      res.status(status).json({ error: err.message });
    }
  });
}
