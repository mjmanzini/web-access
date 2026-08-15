import axios, { AxiosInstance } from 'axios';
import { clientNonce, computeClientProof } from './scram';
import { tag, errorCode, buildRequest } from './xml';

/**
 * Huawei HiLink (B525-class LTE CPE) API client. The router speaks XML over
 * HTTP; requests need a session cookie + a rolling __RequestVerificationToken.
 * The `admin` login is SCRAM-SHA-256 (challenge/response). This client logs in
 * lazily and re-logins on a token/session error.
 *
 * Endpoints used are read-mostly + Wi-Fi MAC filter; nothing here reboots or
 * reconfigures the WAN.
 */
export class HuaweiClient {
  private http: AxiosInstance;
  private token = '';
  private loggedIn = false;
  private readonly username: string;
  private readonly password: string;

  constructor(opts: { baseUrl: string; username: string; password: string; timeoutMs?: number }) {
    this.username = opts.username;
    this.password = opts.password;
    this.http = axios.create({
      baseURL: opts.baseUrl.replace(/\/+$/, ''),
      timeout: opts.timeoutMs ?? 8000,
      headers: { 'Content-Type': 'application/xml' },
      withCredentials: true,
    });
  }

  /** GET the session cookie + request token pair. */
  private async refreshSessionToken(): Promise<void> {
    const { data, headers } = await this.http.get('/api/webserver/SesTokInfo');
    const cookie = tag(data, 'SesInfo');
    this.token = tag(data, 'TokInfo') ?? '';
    if (cookie) this.http.defaults.headers.common['Cookie'] = cookie;
    // Some firmwares also return the token in a header.
    const hdrTok = headers['__requestverificationtoken'];
    if (hdrTok) this.token = Array.isArray(hdrTok) ? hdrTok[0] : hdrTok;
  }

  async login(): Promise<void> {
    await this.refreshSessionToken();
    const nonce = clientNonce();

    // 1) challenge_login → salt, servernonce, iterations
    const challengeBody = buildRequest([
      ['username', this.username],
      ['firstnonce', nonce],
      ['mode', 1],
    ]);
    const { data: cData, headers: cHeaders } = await this.post(
      '/api/user/challenge_login',
      challengeBody,
    );
    const salt = tag(cData, 'salt');
    const servernonce = tag(cData, 'servernonce');
    const iterations = Number(tag(cData, 'iterations') ?? '100');
    if (!salt || !servernonce) throw new Error('Huawei challenge failed (bad credentials or unsupported firmware)');
    this.rollToken(cHeaders);

    // 2) authentication_login → send client proof
    const proof = computeClientProof(this.password, nonce, { salt, servernonce, iterations });
    const authBody = buildRequest([
      ['clientproof', proof],
      ['finalnonce', servernonce],
    ]);
    const { data: aData, headers: aHeaders } = await this.post(
      '/api/user/authentication_login',
      authBody,
    );
    if (errorCode(aData)) throw new Error(`Huawei login rejected (error ${errorCode(aData)})`);
    // On success the router issues a NEW SessionID cookie. Keeping the
    // pre-login cookie leaves every later call unauthenticated — the router
    // answers 125002, or simply resets the connection, which looks like a
    // broken endpoint rather than a broken session.
    this.adoptSessionCookie(aHeaders);
    this.rollToken(aHeaders);
    this.loggedIn = true;
  }

  /** Replace the session cookie with the one issued by a successful login. */
  private adoptSessionCookie(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'] as string[] | string | undefined;
    if (!raw) return;
    const cookies = Array.isArray(raw) ? raw : [raw];
    const session = cookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('SessionID='));
    if (session) this.http.defaults.headers.common['Cookie'] = session;
  }

  /** Adopt the next verification token from a response's headers, if present. */
  private rollToken(headers: Record<string, unknown>): void {
    const t =
      (headers['__requestverificationtoken'] as string) ||
      (headers['__requestverificationtokenone'] as string);
    if (t) this.token = Array.isArray(t) ? t[0] : t;
  }

  /** Login handshake posts, which use the SesTokInfo token. */
  private post(path: string, body: string) {
    return this.http.post(path, body, {
      headers: { __RequestVerificationToken: this.token },
    });
  }

  /**
   * Authenticated writes need a *fresh* verification token. HiLink tokens are
   * single-use, and `/api/webserver/token` returns a 64-char value of which the
   * router accepts only the last 32. Reusing a rolled token from an earlier
   * response is rejected with 125003, which reads like a session failure but is
   * really a spent token.
   */
  private async postWithFreshToken(path: string, body: string) {
    const { data } = await this.http.get('/api/webserver/token');
    const fresh = tag(data, 'token')?.slice(-32) ?? this.token;
    return this.http.post(path, body, {
      headers: { __RequestVerificationToken: fresh },
    });
  }

  /**
   * Authenticated GET returning raw XML (logs in on demand / token errors).
   *
   * The verification token is single-use: every response carries the next one.
   * A GET that fails to adopt it leaves the client holding a spent token, and
   * the *next write* fails with 125003 — a confusing failure, because the read
   * that actually broke it succeeded.
   */
  async apiGet(path: string): Promise<string> {
    if (!this.loggedIn) await this.login();
    const { data, headers } = await this.http.get(path, {
      headers: { __RequestVerificationToken: this.token },
    });
    this.rollToken(headers);
    if (errorCode(data) === '125003' || errorCode(data) === '100003') {
      // token/session expired or forbidden — re-login once and retry.
      this.loggedIn = false;
      await this.login();
      const retry = await this.http.get(path, {
        headers: { __RequestVerificationToken: this.token },
      });
      this.rollToken(retry.headers);
      return retry.data;
    }
    return data;
  }

  /** Authenticated POST of an XML body; returns raw XML. */
  async apiPost(path: string, body: string): Promise<string> {
    if (!this.loggedIn) await this.login();
    const { data, headers } = await this.postWithFreshToken(path, body);
    this.rollToken(headers);
    if (errorCode(data) === '125003' || errorCode(data) === '100003') {
      // Same recovery as reads — settings writes are idempotent, so replaying
      // the body after a fresh login is safe.
      this.loggedIn = false;
      await this.login();
      const retry = await this.postWithFreshToken(path, body);
      this.rollToken(retry.headers);
      return retry.data;
    }
    return data;
  }

  // ---- typed-ish endpoint helpers ----

  /** Device model/name — also a reachability probe. */
  deviceInfo() {
    return this.apiGet('/api/device/information');
  }

  /** Connected clients (Wi-Fi + LAN hosts). */
  hostList() {
    return this.apiGet('/api/wlan/host-list');
  }

  /** Full LAN host table — richer, and includes currently-offline devices. */
  hostInfo() {
    return this.apiGet('/api/lan/HostInfo');
  }

  /** Current multi-SSID MAC-filter settings. */
  macFilter() {
    return this.apiGet('/api/wlan/multi-macfilter-settings');
  }

  /** Apply a multi-SSID MAC-filter payload. */
  setMacFilter(body: string) {
    return this.apiPost('/api/wlan/multi-macfilter-settings', body);
  }
}
