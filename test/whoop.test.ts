import { describe, expect, it, vi } from "vitest";
import { TOKENS_KEY, WHOOP_TOKEN_URL, WhoopAuthError, WhoopClient, backoffMs, type Tokens } from "../src/whoop";

const NOW = 1_800_000_000_000;

function memKV(initial?: Tokens) {
  const store = new Map<string, string>();
  if (initial) store.set(TOKENS_KEY, JSON.stringify(initial));
  return {
    store,
    tokens: () => JSON.parse(store.get(TOKENS_KEY)!) as Tokens,
    get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    put: async (k: string, v: string) => void store.set(k, v),
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const valid = { access_token: "A1", refresh_token: "R1", expires_at: NOW + 3_600_000 };
const expired = { ...valid, expires_at: NOW - 1 };
const creds = { clientId: "cid", clientSecret: "secret" };

function client(kv: ReturnType<typeof memKV>, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(fetchImpl);
  const sleep = vi.fn(async () => {});
  return { c: new WhoopClient(kv, creds, { fetch, sleep, now: () => NOW }), fetch, sleep };
}

describe("token refresh", () => {
  it("refreshes an expired token before calling and persists the rotated refresh token", async () => {
    const kv = memKV(expired);
    const { c, fetch } = client(kv, async (url, init) => {
      if (url === WHOOP_TOKEN_URL) {
        const body = new URLSearchParams(String(init!.body));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("R1");
        expect(body.get("scope")).toBe("offline");
        expect((init!.headers as Record<string, string>)["User-Agent"]).not.toMatch(/Mozilla/);
        return json({ access_token: "A2", refresh_token: "R2", expires_in: 3600, token_type: "bearer" });
      }
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer A2");
      return json({ ok: true });
    });
    expect(await c.get("/v2/user/profile/basic")).toEqual({ ok: true });
    expect(kv.tokens()).toEqual({ access_token: "A2", refresh_token: "R2", expires_at: NOW + 3_600_000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes once on 401 and retries", async () => {
    const kv = memKV(valid);
    let apiCalls = 0;
    const { c } = client(kv, async (url, init) => {
      if (url === WHOOP_TOKEN_URL) return json({ access_token: "A2", refresh_token: "R2", expires_in: 3600 });
      apiCalls++;
      const auth = (init!.headers as Record<string, string>).Authorization;
      return auth === "Bearer A2" ? json({ ok: 1 }) : json({}, 401);
    });
    expect(await c.get("/v2/cycle")).toEqual({ ok: 1 });
    expect(apiCalls).toBe(2);
    expect(kv.tokens().refresh_token).toBe("R2");
  });

  it("concurrent calls share a single refresh (rotation-safe)", async () => {
    const kv = memKV(expired);
    let refreshes = 0;
    const { c } = client(kv, async (url) => {
      if (url === WHOOP_TOKEN_URL) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
        return json({ access_token: "A2", refresh_token: "R2", expires_in: 3600 });
      }
      return json({ ok: 1 });
    });
    await Promise.all([c.get("/a"), c.get("/b"), c.get("/c")]);
    expect(refreshes).toBe(1);
  });

  it("throws WhoopAuthError when refresh is rejected", async () => {
    const kv = memKV(expired);
    const { c } = client(kv, async () => json({ error: "invalid_grant" }, 400));
    await expect(c.get("/v2/cycle")).rejects.toBeInstanceOf(WhoopAuthError);
    expect(kv.tokens().refresh_token).toBe("R1");
  });

  it("throws WhoopAuthError when never connected", async () => {
    const { c } = client(memKV(), async () => json({}));
    await expect(c.get("/v2/cycle")).rejects.toBeInstanceOf(WhoopAuthError);
  });

  it("keeps the old refresh token if WHOOP omits a new one", async () => {
    const kv = memKV(expired);
    const { c } = client(kv, async (url) =>
      url === WHOOP_TOKEN_URL ? json({ access_token: "A2", expires_in: 60 }) : json({}),
    );
    await c.get("/x");
    expect(kv.tokens()).toMatchObject({ access_token: "A2", refresh_token: "R1" });
  });
});

describe("pagination", () => {
  it("follows next_token with limit=25 and passes start/end", async () => {
    const kv = memKV(valid);
    const seen: URL[] = [];
    const { c } = client(kv, async (url) => {
      const u = new URL(url);
      seen.push(u);
      const tok = u.searchParams.get("nextToken");
      if (!tok) return json({ records: [1, 2], next_token: "p2" });
      if (tok === "p2") return json({ records: [3], next_token: "p3" });
      return json({ records: [4], next_token: null });
    });
    const out = await c.getAll("/v2/cycle", { start: "2026-10-01T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z" });
    expect(out).toEqual([1, 2, 3, 4]);
    expect(seen).toHaveLength(3);
    expect(seen[0].pathname).toBe("/developer/v2/cycle");
    expect(seen[0].searchParams.get("limit")).toBe("25");
    expect(seen[0].searchParams.get("start")).toBe("2026-10-01T00:00:00.000Z");
    expect(seen[0].searchParams.has("nextToken")).toBe(false);
    expect(seen[2].searchParams.get("nextToken")).toBe("p3");
    expect(seen[2].searchParams.get("end")).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("rate limiting", () => {
  it("backs off on 429 then succeeds", async () => {
    const kv = memKV(valid);
    let n = 0;
    const { c, sleep } = client(kv, async () =>
      ++n < 3 ? json({}, 429, { "X-RateLimit-Reset": "2" }) : json({ ok: 1 }),
    );
    expect(await c.get("/x")).toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });
  it("backoff prefers Retry-After, caps at 10s, falls back to exponential", () => {
    expect(backoffMs(new Response(null, { status: 429, headers: { "Retry-After": "3" } }), 0)).toBe(3000);
    expect(backoffMs(new Response(null, { status: 429, headers: { "X-RateLimit-Reset": "45" } }), 0)).toBe(10000);
    expect(backoffMs(new Response(null, { status: 429 }), 2)).toBe(4000);
  });
  it("returns null on 404", async () => {
    const { c } = client(memKV(valid), async () => json({}, 404));
    expect(await c.get("/v2/cycle/1/recovery")).toBeNull();
  });
});
