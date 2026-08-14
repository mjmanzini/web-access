/** Human-readable bytes ("1.2 GB") and rates ("3.4 Mbps"). */
export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Bytes/sec → bits/sec, human-readable. */
export function formatRate(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  if (bits < 1000) return `${Math.round(bits)} bps`;
  const units = ['kbps', 'Mbps', 'Gbps'];
  let v = bits / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
