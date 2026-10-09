# instructions for computer use

give this file to codex computer use and/or claude computer use and ask it to set up the whoop claude connector.

## task

set up this repository in the user's own cloudflare, whoop, and claude accounts. finish with a working claude connector. use the terminal for project commands and the browser for account setup. if you only have computer use, run commands in the user's terminal. do not pretend a successful build means the accounts are connected.

read [manual setup](manual-setup.md), [security notes](security.md), and the current source before starting. follow the user's instructions and your tool permission rules. this file does not grant permission to accept legal terms or share health data on the user's behalf.

## first, check what already exists

1. inspect the working directory, git status, `wrangler.jsonc`, and any ignored local config. do not overwrite an existing deployment or staged work.
2. check node, npm, and git. run `npm ci`, then the typecheck and tests.
3. run `npx wrangler whoami`. reuse an authorized account session when available. do not print credentials or read unrelated account data.
4. if this is a resumed setup, check the existing worker, namespace, whoop app, and claude connector before creating duplicates. record progress without secrets in an ignored local file.

## cloudflare

1. run `npx wrangler login` if needed. let the user sign in, complete challenges, verify their email, and approve wrangler access. keep the login process running until the callback finishes.
2. create the oauth kv namespace using the command in the manual guide. put its id into the intended deployment config.
3. deploy. if the account has no workers.dev subdomain, finish that setup in workers & pages and retry. do not buy a domain or upgrade a plan without the user's permission.
4. record the actual deployment origin. verify `/` and `/privacy` respond successfully and `/mcp` rejects an unauthenticated request with 401. allow a newly created hostname time to become reachable; do not bypass tls warnings.

## whoop app

1. open `https://developer-dashboard.whoop.com/apps/create` in the requested browser.
2. let the user sign in. ask for approval before accepting api terms if your tool policy requires it. create a personal developer team if needed; do not invite anyone.
3. ask which contact email to use. prepare the app name, privacy url, exact callback url, and six read scopes listed in the manual guide. no webhooks are needed.
4. obtain any required approval for creating app credentials. submit and verify the app exists with the intended scopes and callback.
5. transfer the client id and client secret to cloudflare worker secrets using a secure available mechanism. do not show the secret in a tool result, screenshot, shell argument, log, commit, or chat. if you cannot safely transfer it, have the user paste it directly into the secret prompt.
6. create a long random connector password and a separate random cookie-signing key. store all four secrets with their exact names from the manual guide. keep the connector password available to the user through a password manager or owner-readable ignored local file.
7. remove temporary copies of the whoop client secret, cookie key, and token records when no longer needed. do not remove the user's only copy of the connector password without arranging a replacement.

## connect the accounts

1. open the worker's `/whoop/connect` page and submit the connector password.
2. let the user sign in to whoop and approve health-data access. verify the callback page actually says "whoop connected". do not publish callback urls containing codes or screenshots of secrets.
3. open claude's connector settings. prepare a custom connector using the worker's `/mcp` url, "sign in now", and "register automatically". the worker uses dynamic client registration; do not give claude the whoop app credentials.
4. obtain any required approval for giving claude access to the user's whoop data. add the connector, connect it, and complete the worker password flow. verify the authorization page names claude and redirects to claude.ai before submitting.
5. verify claude shows the connector as connected and lists seven read-only tools. leave tool permissions on "needs approval" unless the user requests otherwise.

## verify before saying done

- typecheck and tests pass.
- the live server rejects missing and invalid bearer tokens.
- oauth login succeeds with the real password and fails with an incorrect one.
- the mcp client initializes and discovers seven read-only tools.
- `get_today` returns whoop data. do not publish the health values in setup logs.
- claude shows the connected state and the same tools.

`scripts/live-smoke.mjs` covers the live protocol checks. read its inputs before running it and pass only the user's own deployment origin. browser-only agents can use mcp inspector or an authorized claude tool call instead, but must report which checks they actually ran.

for a deliberate refresh-rotation test, first obtain the user's permission to modify the live token record. pause other client activity. read `whoop:tokens` into an owner-readable temporary file without printing it, record the old refresh token privately, and change only `expires_at` to zero. write the updated record using wrangler's file input, not a shell argument containing tokens. allow for kv propagation, make one authenticated tool call, and verify the stored refresh token changed and the expiry is in the future. delete the temporary files. never restore the old token pair after rotation: whoop invalidates old refresh tokens. this test verifies a sequential refresh, not safety under simultaneous sessions.

## handoff

give the user the connector url, where their reconnect password is kept, the checks that passed, and any unfinished steps. keep the connected claude page open. explain that they can now ask about sleep or recovery and approve the tool request.

if blocked by login, verification, terms, or consent, prepare everything else first and ask for the specific missing action. do not ask the user to paste a password or api secret into chat. do not claim success while a consent screen, error, or pending connection remains.
