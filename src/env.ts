import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  namespace Cloudflare {
    interface Env {
      OAUTH_KV: KVNamespace;
      MCP_OBJECT: DurableObjectNamespace;
      WHOOP_CLIENT_ID: string;
      WHOOP_CLIENT_SECRET: string;
      ACCESS_PASSWORD: string;
      COOKIE_ENCRYPTION_KEY: string;
    }
  }
}

export type Env = Cloudflare.Env;
export type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

/** Stored on the Claude grant; surfaced to the MCP agent as `this.props`. */
export type Props = { origin: string };
