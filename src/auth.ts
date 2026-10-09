// Non-MCP routes: the password-gated /authorize page for Claude, and the one-time WHOOP connect flow.
import type { AuthEnv } from "./env";
import { WHOOP_AUTH_URL, WHOOP_SCOPES, exchangeCode } from "./whoop";

const enc = new TextEncoder();

/** Constant-time comparison (hash first so lengths always match). */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 16px;color:#111;background:#fafafa}
input,button{font:inherit;padding:10px;width:100%;box-sizing:border-box;margin-top:8px;border-radius:6px;border:1px solid #ccc}
button{background:#111;color:#fff;border:0;cursor:pointer}.err{color:#b00020}.muted{color:#666;font-size:.9em}
</style></head><body><h2>${esc(title)}</h2>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function passwordForm(action: string, hidden: Record<string, string>, intro: string, error?: string) {
  const fields = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<p class="muted">${intro}</p>${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="${esc(action)}">${fields}
<input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password">
<button type="submit">Continue</button></form>`;
}

// Slow down guessing a little; this is a single-user server.
const failDelay = () => new Promise((r) => setTimeout(r, 1000));

async function authorize(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const title = "Connect Claude to WHOOP";

  if (request.method === "GET") {
    let clientName = "an MCP client";
    try {
      const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
      if (client?.clientName) clientName = client.clientName;
      clientName += ` → ${new URL(authReq.redirectUri).host}`;
    } catch (e) {
      return page("Invalid request", `<p class="err">${esc(e instanceof Error ? e.message : String(e))}</p>`, 400);
    }
    return page(title, passwordForm("/authorize", { q: url.search }, `Authorize <b>${esc(clientName)}</b> to read your WHOOP data.`));
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const q = String(form.get("q") ?? "");
    const password = String(form.get("password") ?? "");
    // Re-parse the original authorization request from the carried query string.
    const original = new Request(`${url.origin}/authorize${q}`, { method: "GET" });
    let authReq;
    try {
      authReq = await env.OAUTH_PROVIDER.parseAuthRequest(original);
    } catch (e) {
      return page("Invalid request", `<p class="err">${esc(e instanceof Error ? e.message : String(e))}</p>`, 400);
    }
    if (!(await passwordMatches(password, env.ACCESS_PASSWORD))) {
      await failDelay();
      return page(title, passwordForm("/authorize", { q }, "Authorize access to your WHOOP data.", "Wrong password."), 401);
    }
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: authReq,
      userId: "owner",
      metadata: { label: "owner" },
      scope: authReq.scope,
      props: { origin: url.origin },
    });
    return Response.redirect(redirectTo, 302);
  }
  return new Response("Method not allowed", { status: 405 });
}

const STATE_COOKIE = "whoop_state";

async function whoopConnect(request: Request, env: AuthEnv): Promise<Response> {
  const title = "Connect WHOOP";
  const intro = "One-time setup: link your WHOOP account to this server.";
  if (request.method === "GET") return page(title, passwordForm("/whoop/connect", {}, intro));
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const form = await request.formData();
  if (!(await passwordMatches(String(form.get("password") ?? ""), env.ACCESS_PASSWORD))) {
    await failDelay();
    return page(title, passwordForm("/whoop/connect", {}, intro, "Wrong password."), 401);
  }
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.OAUTH_KV.put(`whoop:state:${state}`, "1", { expirationTtl: 600 });
  const origin = new URL(request.url).origin;
  const auth = new URL(WHOOP_AUTH_URL);
  auth.search = new URLSearchParams({
    response_type: "code",
    client_id: env.WHOOP_CLIENT_ID,
    redirect_uri: `${origin}/whoop/callback`,
    scope: WHOOP_SCOPES,
    state,
  }).toString();
  const cookie = `${STATE_COOKIE}=${state}.${await hmac(env.COOKIE_ENCRYPTION_KEY, state)}; Path=/whoop; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  return new Response(null, { status: 302, headers: { Location: auth.toString(), "Set-Cookie": cookie } });
}

async function whoopCallback(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const fail = (msg: string, status = 400) => page("WHOOP connection failed", `<p class="err">${esc(msg)}</p>`, status);
  if (url.searchParams.get("error")) {
    return fail(`${url.searchParams.get("error")}: ${url.searchParams.get("error_description") ?? ""}`);
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const cookie = (request.headers.get("Cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  const [cState, cSig] = (cookie ?? "").split(".");
  const validCookie = cState === state && cSig === (await hmac(env.COOKIE_ENCRYPTION_KEY, state));
  if (!state || !code || !validCookie || !(await env.OAUTH_KV.get(`whoop:state:${state}`))) {
    return fail("Invalid or expired state. Start again at /whoop/connect.");
  }
  await env.OAUTH_KV.delete(`whoop:state:${state}`);
  try {
    await exchangeCode(
      env.OAUTH_KV,
      { clientId: env.WHOOP_CLIENT_ID, clientSecret: env.WHOOP_CLIENT_SECRET },
      code,
      `${url.origin}/whoop/callback`,
    );
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
  return page(
    "WHOOP connected",
    `<p>Done. Tokens are stored and will refresh automatically.</p><p class="muted">Add <code>${esc(url.origin)}/mcp</code> as a custom connector in claude.ai.</p>`,
    200,
    { "Set-Cookie": `${STATE_COOKIE}=; Path=/whoop; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
  );
}

export const AuthHandler: ExportedHandler<AuthEnv> = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    switch (pathname) {
      case "/privacy":
        return new Response(
          "Personal WHOOP MCP — Privacy Notice\n\n" +
          "This private integration lets its owner retrieve WHOOP profile, body measurement, cycle, recovery, sleep, and workout data through an authorized MCP client such as Claude.\n\n" +
          "The service runs on Cloudflare. It stores WHOOP access and refresh tokens and MCP authorization records to maintain the connection. Requested WHOOP data is processed by the service and returned to the authorized client. Data sent to Claude is subject to Anthropic's privacy practices.\n\n" +
          "The owner can revoke access through WHOOP and remove the connector from Claude. Stored authorization records can be deleted by the owner through their Cloudflare account. This integration is for personal use and does not sell data.\n",
          { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } },
        );
      case "/authorize":
        return authorize(request, env);
      case "/whoop/connect":
        return whoopConnect(request, env);
      case "/whoop/callback":
        return whoopCallback(request, env);
      case "/":
        return new Response("WHOOP MCP server. Connect Claude to /mcp.", { headers: { "Content-Type": "text/plain" } });
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};
