'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TopBar } from '../../../../components/theme/TopBar';
import {
  verifyPartnerQr,
  parsePartnerQrPayload,
  type PartnerQrVerifyResult,
} from '../../../../lib/khuloh/client';
import { loadStoredUser, signalingUrl } from '../../../../lib/user-session';

interface Coords { lat: number; lng: number }

// Use the Shape Detection API when available (Chrome/Edge). Otherwise we fall
// back to a paste-text input so the page is still usable on Safari/Firefox.
function getBarcodeDetector(): { detect: (s: ImageBitmapSource) => Promise<{ rawValue: string }[]> } | null {
  if (typeof window === 'undefined') return null;
  const W = window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (s: ImageBitmapSource) => Promise<{ rawValue: string }[]> } };
  if (!W.BarcodeDetector) return null;
  try { return new W.BarcodeDetector({ formats: ['qr_code'] }); } catch { return null; }
}

export default function SafeSpotScanPage() {
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef    = useRef<number | null>(null);
  const [supported, setSupported] = useState<boolean>(true);
  const [scanning, setScanning]   = useState<boolean>(false);
  const [manual, setManual]       = useState<string>('');
  const [meetupId, setMeetupId]   = useState<string>('');
  const [coords, setCoords]       = useState<Coords | null>(null);
  const [result, setResult]       = useState<PartnerQrVerifyResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState<boolean>(false);

  // Geolocate on mount so we can include lat/lng with verification.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setError(e.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  function stopCamera() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  useEffect(() => () => stopCamera(), []);

  async function startCamera() {
    setError(null); setResult(null);
    const detector = getBarcodeDetector();
    if (!detector) { setSupported(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length) {
            const raw = codes[0].rawValue;
            const token = parsePartnerQrPayload(raw);
            if (token) {
              stopCamera();
              await submitToken(token);
              return;
            }
          }
        } catch { /* one-off detect errors are OK */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submitToken(token: string) {
    const u = loadStoredUser();
    if (!u) { setError('not_signed_in'); return; }
    if (!coords) { setError('location_required'); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await verifyPartnerQr(signalingUrl(), u.token, {
        token, lat: coords.lat, lng: coords.lng,
        meetupId: meetupId.trim() || undefined,
      });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = parsePartnerQrPayload(manual.trim());
    if (!token) { setError('not_a_khuloh_qr'); return; }
    void submitToken(token);
  }

  return (
    <main className="wa-hub">
      <TopBar />
      <div className="wa-hub-head">
        <span className="wa-kicker">Khuloh · Safe-Spots</span>
        <h1>Scan Safe-Spot QR</h1>
        <p>Point your camera at the QR code displayed at the venue to check in.</p>
      </div>

      <section className="wa-waiting-room">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!scanning ? (
            <button className="wa-primary-btn" onClick={() => void startCamera()} disabled={busy}>
              {supported ? 'Open camera' : 'Camera not supported'}
            </button>
          ) : (
            <button className="add-contact-secondary" onClick={stopCamera}>Stop camera</button>
          )}
          <Link href="/zones/safe-spots" className="add-contact-secondary">Back to Safe-Spots</Link>
        </div>

        {scanning && (
          <div style={{ marginTop: 12, position: 'relative' }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', maxWidth: 480, borderRadius: 12, background: '#000' }}
            />
            <p style={{ fontSize: 12, color: 'var(--wa-muted)', marginTop: 6 }}>
              Hold the QR ~15 cm from the camera. Detection runs locally on-device.
            </p>
          </div>
        )}

        {!supported && (
          <p style={{ fontSize: 13, color: 'var(--wa-muted)', marginTop: 12 }}>
            Your browser doesn't support live QR detection. Paste the code below instead.
          </p>
        )}
      </section>

      <section className="wa-waiting-room">
        <h3 className="wa-settings-title">Or paste a code</h3>
        <form onSubmit={onManualSubmit} style={{ display: 'grid', gap: 8 }}>
          <input
            placeholder="khuloh://safe-spot?d=…  or raw token"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <input
            placeholder="Meetup ID (optional — to check in to a scheduled meetup)"
            value={meetupId}
            onChange={(e) => setMeetupId(e.target.value)}
          />
          <button type="submit" className="wa-primary-btn" disabled={busy || !manual.trim()}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>
        {!coords && <p style={{ fontSize: 12, color: 'tomato' }}>Location not available — required for check-in.</p>}
      </section>

      {error && (
        <section className="wa-waiting-room">
          <p style={{ color: 'tomato' }}>Error: {error}</p>
        </section>
      )}

      {result && (
        <section className="wa-waiting-room">
          <h3 className="wa-settings-title">✓ Checked in at {result.spot.name}</h3>
          <p style={{ fontSize: 13, color: 'var(--wa-muted)' }}>{result.spot.city}</p>
          {result.spot.deal_text && (
            <p style={{ color: 'var(--wa-accent)', fontWeight: 600 }}>Partner deal: {result.spot.deal_text}</p>
          )}
          {result.meetup && (
            <p style={{ fontSize: 13 }}>
              Meetup <code>{result.meetup.id}</code> status: <strong>{result.meetup.status}</strong>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
