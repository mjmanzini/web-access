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
    this.rollToken(aHeaders);
    this.loggedIn = true;
  }

  /** Adopt the next verification token from a response's headers, if present. */
  private rollToken(headers: Record<string, unknown>): void {
    const t =
      (headers['__requestverificationtoken'] as string) ||
      (headers['__requestverificationtokenone'] as string);
    if (t) this.token = Array.isArray(t) ? t[0] : t;
  }

  private post(path: string, body: string) {
    return this.http.post(path, body, {
      headers: { __RequestVerificationToken: this.token },
    });
  }

  /** Authenticated GET returning raw XML (logs in on demand / token errors). */
  async apiGet(path: string): Promise<string> {
    if (!this.loggedIn) await this.login();
    const { data } = await this.http.get(path, {
      headers: { __RequestVerificationToken: this.token },
    });
    if (errorCode(data) === '125003' || errorCode(data) === '100003') {
      // token/session expired or forbidden — re-login once and retry.
      this.loggedIn = false;
      await this.login();
      const retry = await this.http.get(path, {
        headers: { __RequestVerificationToken: this.token },
      });
      return retry.data;
    }
    return data;
  }

  /** Authenticated POST of an XML body; returns raw XML. */
  async apiPost(path: string, body: string): Promise<string> {
    if (!this.loggedIn) await this.login();
    const { data, headers } = await this.post(path, body);
    this.rollToken(headers);
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

  /** Current multi-SSID MAC-filter settings. */
  macFilter() {
    return this.apiGet('/api/wlan/multi-macfilter-settings');
  }

  /** Apply a multi-SSID MAC-filter payload. */
  setMacFilter(body: string) {
    return this.apiPost('/api/wlan/multi-macfilter-settings', body);
  }
}
