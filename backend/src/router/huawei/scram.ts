import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * SCRAM-SHA-256 client proof, as Huawei HiLink routers (B525 etc.) implement it
 * for the `admin` login. The router replies to a challenge with salt +
 * server-nonce + iteration count; we derive the client proof and send it back.
 *
 * Pure + deterministic (given a fixed client nonce) so it's unit-testable
 * without a device. Auth message format matches Huawei's:
 *   authMessage = clientnonce + "," + servernonce + "," + servernonce
 */

/** 32 random bytes as 64 hex chars — the SCRAM client (first) nonce. */
export function clientNonce(): string {
  return randomBytes(32).toString('hex');
}

/** XOR two equal-length buffers. */
export function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

export interface ScramChallenge {
  salt: string; // hex
  servernonce: string;
  iterations: number;
}

/** Compute the hex-encoded SCRAM client proof for a Huawei login. */
export function computeClientProof(
  password: string,
  clientnonce: string,
  challenge: ScramChallenge,
): string {
  const saltedPassword = pbkdf2Sync(
    password,
    Buffer.from(challenge.salt, 'hex'),
    challenge.iterations,
    32,
    'sha256',
  );
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const authMessage = `${clientnonce},${challenge.servernonce},${challenge.servernonce}`;
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
  return xorBuffers(clientKey, clientSignature).toString('hex');
}
