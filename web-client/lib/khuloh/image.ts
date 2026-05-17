/**
 * khuloh/image.ts — adaptive client-side image downscaler.
 *
 * South African mobile users on 2G/3G burn through caps on full-resolution
 * photos. This helper uses the (experimental) Network Information API to
 * pick a sane max dimension and JPEG quality, then re-encodes via the
 * canvas. Falls back to a "fast Wi-Fi" tier when the API isn't exposed.
 *
 * Usage:
 *   const { file, originalBytes, encodedBytes } = await downsizeForNetwork(rawFile);
 *   fetch('/upload', { method: 'POST', body: file });
 */

export type NetworkTier = 'slow-2g' | '2g' | '3g' | '4g' | 'wifi' | 'unknown';

export interface DownsizeOptions {
  /** Force a tier, overriding navigator.connection sniffing. */
  tier?: NetworkTier;
  /** Hard cap regardless of tier. */
  maxDimension?: number;
  /** Re-encode quality 0..1 override. */
  quality?: number;
}

export interface DownsizeResult {
  file: File;
  tier: NetworkTier;
  maxDimension: number;
  quality: number;
  originalBytes: number;
  encodedBytes: number;
  downsized: boolean;
}

// Per-tier preset: max-dimension (longest edge px), JPEG quality.
const TIER_PRESET: Record<NetworkTier, { maxDimension: number; quality: number }> = {
  'slow-2g': { maxDimension: 320,  quality: 0.55 },
  '2g':      { maxDimension: 480,  quality: 0.60 },
  '3g':      { maxDimension: 720,  quality: 0.70 },
  '4g':      { maxDimension: 1280, quality: 0.80 },
  'wifi':    { maxDimension: 1920, quality: 0.85 },
  'unknown': { maxDimension: 1280, quality: 0.80 },
};

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
  type?: string;
}

export function detectNetworkTier(): NetworkTier {
  if (typeof navigator === 'undefined') return 'unknown';
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!conn) return 'unknown';
  // Save-Data is the strongest signal — user explicitly asked for less.
  if (conn.saveData) return '2g';
  if (conn.type === 'wifi' || conn.type === 'ethernet') return 'wifi';
  switch (conn.effectiveType) {
    case 'slow-2g': return 'slow-2g';
    case '2g':      return '2g';
    case '3g':      return '3g';
    case '4g':      return '4g';
    default:        return 'unknown';
  }
}

/**
 * Downscale + recompress an image File only if the chosen tier indicates
 * doing so will save meaningful bytes.
 */
export async function downsizeForNetwork(
  file: File,
  options: DownsizeOptions = {},
): Promise<DownsizeResult> {
  const tier = options.tier ?? detectNetworkTier();
  const preset = TIER_PRESET[tier];
  const maxDimension = options.maxDimension ?? preset.maxDimension;
  const quality = options.quality ?? preset.quality;

  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return {
      file, tier, maxDimension, quality,
      originalBytes: file.size, encodedBytes: file.size, downsized: false,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return {
      file, tier, maxDimension, quality,
      originalBytes: file.size, encodedBytes: file.size, downsized: false,
    };
  }

  const { width, height } = bitmap;
  const longest = Math.max(width, height);
  // If already small enough, skip — but still re-encode at lower quality
  // for 2g/slow-2g to catch oversized JPEGs.
  const needsResize = longest > maxDimension;
  const aggressiveRecompress = tier === 'slow-2g' || tier === '2g';
  if (!needsResize && !aggressiveRecompress) {
    bitmap.close?.();
    return {
      file, tier, maxDimension, quality,
      originalBytes: file.size, encodedBytes: file.size, downsized: false,
    };
  }

  const scale = needsResize ? maxDimension / longest : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const blob = await drawToBlob(bitmap, targetW, targetH, quality);
  bitmap.close?.();

  // Guard against the canvas making things larger (rare on already-tiny WebP).
  if (blob.size >= file.size) {
    return {
      file, tier, maxDimension, quality,
      originalBytes: file.size, encodedBytes: file.size, downsized: false,
    };
  }

  const out = new File([blob], replaceExt(file.name, 'jpg'), { type: 'image/jpeg' });
  return {
    file: out, tier, maxDimension, quality,
    originalBytes: file.size, encodedBytes: out.size, downsized: true,
  };
}

async function drawToBlob(bitmap: ImageBitmap, w: number, h: number, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(w, h);
    const ctx = oc.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return oc.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', quality),
  );
}

function replaceExt(name: string, ext: string): string {
  const i = name.lastIndexOf('.');
  return (i <= 0 ? name : name.slice(0, i)) + '.' + ext;
}
