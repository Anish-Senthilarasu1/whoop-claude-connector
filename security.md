# security notes

this is a personal, single-user connector. it has useful protections, but it is not an independently audited service. a working connection and passing tests do not prove it is secure against every attack.

## what protects it

- the mcp endpoint requires a bearer token. claude gets one through oauth with pkce after the owner enters the connector password.
- the whoop connection uses a random state value, a signed http-only cookie, and a short-lived state record. the callback checks them before exchanging a code.
- the tools call whoop's read endpoints. they do not change your whoop account or workouts.
- app credentials and the connector password are configured as cloudflare worker secrets. the repository only includes empty examples.
- the authorization pages disable framing and caching.

## where your data goes

whoop sends requested data to your worker on cloudflare. the worker returns it to the authenticated mcp client, including claude when connected. that makes both cloudflare and the client part of the trust boundary.

whoop access and refresh tokens are stored in workers kv alongside the provider's oauth records. the application does not separately encrypt the whoop token json. cloudflare's platform protections do not prevent a compromised account or authorized worker code from reading it. `COOKIE_ENCRYPTION_KEY` signs connection cookies; it is not token encryption.

the application fetches whoop measurements live rather than maintaining its own health-data database. that does not mean every layer has zero retention: clients can retain conversations, infrastructure can retain logs, and the mcp runtime manages sessions. do not enable request-body or response-body logging for sensitive traffic.

## limits to know about

1. **one shared password.** anyone who learns the connector password can authorize a client to read the connected account. there is no separate identity check or multi-factor login on the worker's password page. use a strong generated password and protect your cloudflare and claude accounts with multi-factor authentication.
2. **no effective login rate limit in the application.** a wrong password waits one second before returning, but parallel requests are still possible. public client registration can also create storage entries. proper rate limiting and abuse controls would be needed for broader use.
3. **refresh locking is local to one client instance.** separate mcp sessions can refresh the shared whoop token at the same time. kv is eventually consistent and is not a distributed lock. the reread checks reduce some failures but do not eliminate this race. a single durable token owner with serialized refreshes is the next reliability improvement before supporting concurrent users or clients.
4. **one account per deployment.** oauth grants use the same owner identity and the same whoop token key. sharing this server does not create separate user accounts. other people should deploy their own copy.
5. **read-only still means sensitive.** sleep, heart rate, recovery, body measurements, and profile details are personal data. tool annotations describe intent; they do not replace authentication or control what claude retains.
6. **revocation has several layers.** changing the connector password blocks new password logins but does not itself revoke existing oauth grants. removing the connector from claude also does not delete all cloudflare records. revoke the whoop app in whoop to stop upstream access, revoke client grants as appropriate, and remove stored records when retiring the server.
7. **local setup files can contain plaintext secrets.** git ignores `.wrangler`, local environment files, and `wrangler.local.jsonc`, but that does not encrypt them. use owner-only permissions, avoid shared folders and backups for temporary tokens, and never attach these files to issues.

## verification status

the original deployment passed 34 unit tests, typechecking, live oauth with pkce, rejection of invalid credentials, seven-tool discovery, real data retrieval, and a sequential forced-expiry refresh test. these are functional checks, not a penetration test. a third-party code review is not included in that claim.

before using this as a shared service, address rate limiting, per-user authorization, serialized token refresh, and secret lifecycle management, then arrange an independent security review.

## dependency scan

the publication-time `npm audit` scan reported 9 affected dependency entries: 2 critical, 6 high, and 1 moderate. `npm audit --omit=dev` reported 3 high entries. counts include packages that inherit an advisory from another package; they are not nine distinct exploits.

the production entries concern the mcp sdk's oauth client. the advisory explicitly excludes mcp servers, and the live check uses a manually obtained bearer token rather than that oauth client flow. the `agents` package pins the affected sdk peer versions, so a direct upgrade currently conflicts with its supported dependency set. this remains an upstream dependency maintenance issue, not proof that this server's password or whoop tokens have leaked.

the full scan also flags the local test and development stack, including vitest/tinypool and wrangler/miniflare/sharp. these findings are not a clean bill of health for development machines. avoid exposing development servers or processing untrusted inputs with affected tooling. update to compatible patched releases and rerun checks before broader use; do not blindly apply `npm audit fix --force`.

- [mcp oauth-client advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
- [tinypool advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)
- [vitest mocker advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)
- [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)

## references

- [whoop oauth and refresh tokens](https://developer.whoop.com/docs/developing/oauth/)
- [workers kv consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [cloudflare worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
