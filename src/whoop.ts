// Minimal WHOOP v2 client: single token pair in KV, auto-refresh with rotation, pagination, 429 backoff.

export const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
export const WHOOP_API = "https://api.prod.whoop.com/developer";
export const WHOOP_SCOPES = "offline read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout";
export const TOKENS_KEY = "whoop:tokens";
// WHOOP has been reported to reject browser-like User-Agents on the token endpoint.
const USER_AGENT = "whoop-mcp/1.0";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export interface KVLike {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export interface Creds {
  clientId: string;
  clientSecret: string;
}

export class WhoopAuthError extends Error {}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface Deps {
  fetch?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

async function tokenRequest(fetchFn: FetchFn, body: Record<string, string>): Promise<Response> {
  return fetchFn(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  });
}

function toTokens(json: any, now: number, previousRefresh?: string): Tokens {
  if (!json?.access_token) throw new WhoopAuthError("WHOOP token response missing access_token");
  const refresh = json.refresh_token ?? previousRefresh;
  if (!refresh) throw new WhoopAuthError("WHOOP did not return a refresh token (is the `offline` scope enabled?)");
  return {
    access_token: json.access_token,
    refresh_token: refresh,
    expires_at: now + (Number(json.expires_in) || 3600) * 1000,
  };
}

/** One-time authorization-code exchange from /whoop/callback. Persists the token pair. */
export async function exchangeCode(
  kv: KVLike,
  creds: Creds,
  code: string,
  redirectUri: string,
  deps: Deps = {},
): Promise<Tokens> {
  const fetchFn = deps.fetch ?? fetch;
  const res = await tokenRequest(fetchFn, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  if (!res.ok) throw new Error(`WHOOP token exchange failed (${res.status}): ${await res.text()}`);
  const tokens = toTokens(await res.json(), (deps.now ?? Date.now)());
  await kv.put(TOKENS_KEY, JSON.stringify(tokens));
  return tokens;
}

export class WhoopClient {
  private fetchFn: FetchFn;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  private refreshing?: Promise<Tokens>;

  constructor(
    private kv: KVLike,
    private creds: Creds,
    deps: Deps = {},
  ) {
    this.fetchFn = deps.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  private async loadTokens(): Promise<Tokens> {
    const t = (await this.kv.get(TOKENS_KEY, "json")) as Tokens | null;
    if (!t?.refresh_token) throw new WhoopAuthError("WHOOP is not connected yet.");
    return t;
  }

  /** Refresh is single-flight: WHOOP rotates refresh tokens, so concurrent refreshes would revoke each other. */
  refresh(stale: Tokens): Promise<Tokens> {
    this.refreshing ??= this.doRefresh(stale).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(stale: Tokens): Promise<Tokens> {
    // Another isolate may already have rotated the pair.
    const current = await this.loadTokens();
    if (current.refresh_token !== stale.refresh_token && current.expires_at - 60_000 > this.now()) {
      return current;
    }
    const res = await tokenRequest(this.fetchFn, {
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      scope: "offline",
    });
    if (!res.ok) {
      const reread = await this.loadTokens();
      if (reread.refresh_token !== current.refresh_token) return reread;
      throw new WhoopAuthError(`WHOOP token refresh failed (${res.status}).`);
    }
    const tokens = toTokens(await res.json(), this.now(), current.refresh_token);
    await this.kv.put(TOKENS_KEY, JSON.stringify(tokens));
    return tokens;
  }

  private async validTokens(): Promise<Tokens> {
    const t = await this.loadTokens();
    return t.expires_at - 60_000 <= this.now() ? this.refresh(t) : t;
  }

  /** GET a WHOOP endpoint. Returns null on 404. */
  async get<T = any>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T | null> {
    const url = new URL(WHOOP_API + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

    let tokens = await this.validTokens();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url.toString(), {
        headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": USER_AGENT },
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        tokens = await this.refresh(tokens);
        continue;
      }
      if (res.status === 429 && attempt < 3) {
        await this.sleep(backoffMs(res, attempt));
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 401) throw new WhoopAuthError("WHOOP rejected the access token after refresh.");
      if (!res.ok) throw new Error(`WHOOP API ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()) as T;
    }
  }

  /** Follow next_token through every page (limit 25 = WHOOP max). */
  async getAll<T = any>(path: string, params: { start?: string; end?: string } = {}, maxPages = 40): Promise<T[]> {
    const out: T[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const body = await this.get<{ records: T[]; next_token?: string }>(path, { ...params, limit: 25, nextToken });
      if (!body) break;
      out.push(...(body.records ?? []));
      nextToken = body.next_token || undefined;
      if (!nextToken) break;
    }
    return out;
  }
}

export function backoffMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("Retry-After"));
  const reset = Number(res.headers.get("X-RateLimit-Reset"));
  const secs = retryAfter > 0 ? retryAfter : reset > 0 ? reset : 2 ** attempt;
  return Math.min(secs, 10) * 1000;
}
