import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { AuthHandler } from "./auth";
import type { Env, Props } from "./env";
import { registerTools } from "./tools";
import { WhoopClient } from "./whoop";

export class WhoopMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "whoop", version: "1.0.0" });
  private whoop?: WhoopClient;

  async init() {
    registerTools(
      this.server,
      () =>
        (this.whoop ??= new WhoopClient(this.env.OAUTH_KV, {
          clientId: this.env.WHOOP_CLIENT_ID,
          clientSecret: this.env.WHOOP_CLIENT_SECRET,
        })),
      () => this.props?.origin,
    );
  }
}

// The provider needs a canonical resource URL (RFC 9728). Derive it from the request origin so the
// same code works on workers.dev and `wrangler dev` without extra config.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: WhoopMCP.serve("/mcp"),
      defaultHandler: AuthHandler as ExportedHandler<Env>,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      accessTokenTTL: 3600,
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: "WHOOP" },
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request, env, ctx) {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
