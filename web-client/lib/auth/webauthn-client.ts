/**
 * WebAuthn client — passkey / Face ID / Fingerprint login for the PWA.
 *
 * Pairs with signaling-server/src/auth/webauthn.js.
 * Uses @simplewebauthn/browser to handle base64url <-> ArrayBuffer plumbing.
 *
 *   pnpm add @simplewebauthn/browser
 */
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';

const API = process.env.NEXT_PUBLIC_API_BASE ?? '';

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('web-access.user');
    if (!raw) return {};
    const user = JSON.parse(raw) as { token?: string };
    return user?.token ? { authorization: `Bearer ${user.token}` } : {};
  } catch {
    return {};
  }
}

export const webauthn = {
  isSupported: () => browserSupportsWebAuthn(),
  hasPlatformAuthenticator: () => platformAuthenticatorIsAvailable(),

  /**
   * Register a new passkey for the currently logged-in user.
   * Call this from a "Set up Face ID / Fingerprint" button after onboarding.
   */
  async register(deviceLabel?: string): Promise<{ ok: true; credentialId: string }> {
    // 1. Ask server for PublicKeyCredentialCreationOptions
    const optsRes = await fetch(`${API}/api/auth/webauthn/register/options`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ deviceLabel }),
    });
    if (!optsRes.ok) throw new Error('webauthn_register_options_failed');
    const options = await optsRes.json();

    // 2. Browser invokes platform authenticator (Face ID / Touch ID / Windows Hello).
    //    `userVerification: 'required'` forces biometric/PIN on the device.
    const attResp = await startRegistration({ optionsJSON: options });

    // 3. Send attestation back; server verifies + stores in auth_credentials.
    const verifyRes = await fetch(`${API}/api/auth/webauthn/register/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ attResp, deviceLabel }),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok || !data.verified) throw new Error(data.error ?? 'webauthn_register_failed');
    return { ok: true, credentialId: data.credentialId };
  },

  /**
   * Authenticate with an existing passkey.
   * `username` is optional — when omitted we use a discoverable credential
   * (resident key) so the user just taps Face ID without typing anything.
   */
  async authenticate(username?: string): Promise<{ ok: true; token: string; userId: string }> {
    const optsRes = await fetch(`${API}/api/auth/webauthn/authenticate/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (!optsRes.ok) throw new Error('webauthn_auth_options_failed');
    const options = await optsRes.json();

    const assertion = await startAuthentication({ optionsJSON: options });

    const verifyRes = await fetch(`${API}/api/auth/webauthn/authenticate/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assertion }),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok || !data.verified) throw new Error(data.error ?? 'webauthn_auth_failed');
    return { ok: true, token: data.token, userId: data.userId };
  },

  /**
   * Step-up auth — re-prompt biometric for a sensitive action
   * (e.g. starting an unattended remote-desktop session).
   * Returns a short-lived assertion token the server can verify.
   */
  async stepUp(action: string): Promise<string> {
    const optsRes = await fetch(`${API}/api/auth/webauthn/stepup/options`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action }),
    });
    if (!optsRes.ok) throw new Error('webauthn_stepup_options_failed');
    const options = await optsRes.json();
    const assertion = await startAuthentication({ optionsJSON: options });
    const verifyRes = await fetch(`${API}/api/auth/webauthn/stepup/verify`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ assertion, action }),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok || !data.verified) throw new Error(data.error ?? 'stepup_failed');
    return data.stepupToken as string;
  },
};
