import axios, { AxiosInstance } from 'axios';

/**
 * Minimal OpenWrt ubus-over-HTTP (JSON-RPC) client. Requires the router to have
 * `uhttpd-mod-ubus` (the `/ubus` endpoint) plus rpcd ACLs granting the API user
 * access to `file` (read/exec) and `system`. We log in for a session token and
 * reuse it, re-authenticating on expiry.
 *
 * ubus call shape: params = [ <session>, <object>, <method>, <args> ]
 * result shape:    [ <code>, <data> ]   (code 0 == ok)
 */
export class OpenWrtClient {
  private http: AxiosInstance;
  private session = '00000000000000000000000000000000'; // anonymous until login
  private readonly username: string;
  private readonly password: string;

  constructor(opts: {
    baseUrl: string;
    username: string;
    password: string;
    timeoutMs?: number;
  }) {
    this.username = opts.username;
    this.password = opts.password;
    this.http = axios.create({
      baseURL: opts.baseUrl.replace(/\/+$/, ''),
      timeout: opts.timeoutMs ?? 8000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async rpc(
    object: string,
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<any> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'call',
      params: [this.session, object, method, args],
    };
    const { data } = await this.http.post('/ubus', body);
    if (data?.error) throw new Error(`ubus error: ${data.error.message}`);
    const [code, payload] = data?.result ?? [];
    if (code === 6) {
      // Access denied / expired session — re-login once and retry.
      await this.login();
      return this.rpcAfterLogin(object, method, args);
    }
    if (code !== 0) throw new Error(`ubus ${object}.${method} returned ${code}`);
    return payload;
  }

  private async rpcAfterLogin(
    object: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'call',
      params: [this.session, object, method, args],
    };
    const { data } = await this.http.post('/ubus', body);
    const [code, payload] = data?.result ?? [];
    if (code !== 0) throw new Error(`ubus ${object}.${method} returned ${code}`);
    return payload;
  }

  async login(): Promise<void> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'call',
      params: [
        '00000000000000000000000000000000',
        'session',
        'login',
        { username: this.username, password: this.password, timeout: 3600 },
      ],
    };
    const { data } = await this.http.post('/ubus', body);
    const sid = data?.result?.[1]?.ubus_rpc_session;
    if (!sid) throw new Error('OpenWrt login failed (check credentials / ubus ACLs)');
    this.session = sid;
  }

  /** Board/model info (also serves as a reachability probe). */
  async boardInfo(): Promise<{ model: string | null }> {
    const info = await this.rpc('system', 'board', {});
    return { model: info?.model ?? info?.board_name ?? null };
  }

  /** Read a file on the router (e.g. /tmp/dhcp.leases). */
  async readFile(path: string): Promise<string> {
    const res = await this.rpc('file', 'read', { path });
    return res?.data ?? '';
  }

  /** Execute a command on the router; returns stdout (throws on non-zero). */
  async exec(command: string, params: string[] = []): Promise<string> {
    const res = await this.rpc('file', 'exec', { command, params });
    if (res?.code && res.code !== 0) {
      throw new Error(`exec ${command} failed (${res.code}): ${res.stderr ?? ''}`);
    }
    return res?.stdout ?? '';
  }

  /** Run a batch of `nft` argument-vectors, best-effort per command. */
  async nft(commandLines: string[]): Promise<void> {
    for (const line of commandLines) {
      // nft accepts the whole statement as one argv when passed via `-`? We pass
      // the tokenized args directly to avoid a shell.
      await this.exec('nft', line.split(' ').filter(Boolean));
    }
  }
}
