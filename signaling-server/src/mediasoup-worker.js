/**
 * Mediasoup worker singleton.
 *
 * We run a *single* worker process for simplicity. Mediasoup can scale to
 * multiple workers (one per CPU core) but one worker already supports
 * dozens of participants — plenty for a Teams-style small-team call.
 */
import * as mediasoup from 'mediasoup';
import os from 'node:os';

let workerPromise = null;

// Broadly safe range; pick a window that doesn't collide with other services.
const RTC_MIN_PORT = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
const RTC_MAX_PORT = Number(process.env.MEDIASOUP_MAX_PORT || 40200);

// Public IP/hostname the SFU advertises in its ICE candidates. Defaults to
// the first non-internal IPv4 interface; override with MEDIASOUP_ANNOUNCED_IP
// (e.g. your LAN IP, or a public IP if you expose the server to the internet).
function detectLanIp() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}
export const ANNOUNCED_IP = process.env.MEDIASOUP_ANNOUNCED_IP || detectLanIp();

// Minimal, widely-supported codec set. Adding H264 helps iOS Safari interop.
export const ROUTER_MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

export async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await mediasoup.createWorker({
        logLevel: 'warn',
        rtcMinPort: RTC_MIN_PORT,
        rtcMaxPort: RTC_MAX_PORT,
      });
      w.on('died', () => {
        // eslint-disable-next-line no-console
        console.error('[mediasoup] worker died, exiting so the host can restart us');
        setTimeout(() => process.exit(1), 100);
      });
      // eslint-disable-next-line no-console
      console.log(
        `[mediasoup] worker ready pid=${w.pid} rtc=${RTC_MIN_PORT}-${RTC_MAX_PORT} announcedIp=${ANNOUNCED_IP}`,
      );
      return w;
    })();
  }
  return workerPromise;
}

/**
 * Config for WebRTC transports — the ICE candidates the SFU tells peers
 * to connect to. For LAN use, `ANNOUNCED_IP` is your machine's LAN IP.
 */
export const WEBRTC_TRANSPORT_OPTIONS = {
  listenIps: [{ ip: '0.0.0.0', announcedIp: ANNOUNCED_IP }],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 1_000_000,
};
