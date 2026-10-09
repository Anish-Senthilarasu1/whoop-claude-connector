# manual setup

## 1. get the project ready

install a current node.js lts release and git. clone this repo, open a terminal in it, then run:

```sh
npm ci
npm run typecheck
npm test
npx wrangler login
```

sign in to cloudflare and approve wrangler. verify your email if cloudflare asks. use your own account for every step below.

## 2. create storage and deploy

```sh
npx wrangler kv namespace create OAUTH_KV
```

copy the returned namespace id into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`. this is a resource identifier, not a password. don't copy someone else's id.

```sh
npx wrangler deploy
```

if cloudflare says you need a workers.dev subdomain, open workers & pages in the dashboard and finish that setup, then rerun the command. keep the deployment url it prints. use that actual url wherever this guide says `https://your-worker.workers.dev`.

the server is online now, but cannot access whoop until the remaining steps are done. the privacy notice is at `/privacy`.

## 3. create a whoop app

open [the whoop developer dashboard](https://developer-dashboard.whoop.com/apps/create). sign in, review the api terms, and create a developer team if asked.

create an app with these settings:

- name: personal whoop mcp
- contact: your email address
- privacy policy: `https://your-worker.workers.dev/privacy`
- redirect url: `https://your-worker.workers.dev/whoop/callback`
- scopes: `read:profile`, `read:body_measurement`, `read:cycles`, `read:recovery`, `read:sleep`, `read:workout`
- webhooks: none

check that the privacy notice accurately describes your use before submitting it. a personal app only needs the developer tier that permits your own account. the server requests `offline` during authorization so the connection can refresh.

keep the client id and client secret private. the client id identifies your app; the secret authenticates it to whoop.

## 4. set the secrets

these commands prompt for each value. paste values at the prompt, not into a command, chat, or commit.

```sh
npx wrangler secret put WHOOP_CLIENT_ID
npx wrangler secret put WHOOP_CLIENT_SECRET
npx wrangler secret put ACCESS_PASSWORD
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

use a new, long, random password for `ACCESS_PASSWORD` and save it in your password manager. do not reuse your whoop password. generate a separate random value for `COOKIE_ENCRYPTION_KEY`, such as 32 random bytes encoded as hex. despite its name, this key signs the whoop connection cookie; it does not encrypt the token records.

## 5. connect whoop

open `https://your-worker.workers.dev/whoop/connect`. enter your new connector password, sign in to whoop, and approve the requested read access. wait for the page to say "whoop connected".

## 6. add it to claude

open claude, then customize → connectors → add custom connector. older versions may put this under settings → connectors.

- name: whoop
- server url: `https://your-worker.workers.dev/mcp`
- authentication: sign in now
- oauth client: register automatically

add it, click connect, and enter your connector password on your worker's authorization page. do not enter your whoop client secret into claude. leave any optional oauth client id and secret fields blank when using automatic registration.

verify that claude shows a disconnect button and seven read-only tools. leave them on "needs approval" to start.

ask claude: "use whoop to summarize my sleep and recovery today." approve the tool request. check the result against your whoop app.

## checks

```sh
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

for a scripted live test, save just your connector password as a json object with the exact key `ACCESS_PASSWORD` in `.wrangler/setup/secrets.json`. create the directory with owner-only permissions and make the file readable only by you. this folder is ignored by git. the file is plaintext, so remove it when you no longer need the test.

```sh
node scripts/live-smoke.mjs https://your-worker.workers.dev
```

only pass your own worker origin. the script sends your connector password to that origin. it checks oauth with pkce, invalid passwords and bearer tokens, seven read-only tools, and real whoop data. it prints field names, not health values or credentials, and revokes its successful test grant at the end. it creates an oauth client registration in your namespace.

## if something goes wrong

- cloudflare asks to verify your account: click the link in its email, then retry.
- whoop rejects the redirect: compare the developer app url with the actual worker url, including `/whoop/callback`.
- wrong password: use `ACCESS_PASSWORD`, not your whoop account password.
- a tool asks you to reconnect: repeat step 5. revoked refresh tokens cannot be repaired by retrying a tool.
- no recent data: confirm whoop has synced and finished scoring. missing or pending scores are not necessarily connection failures.

## local development

```sh
cp .dev.vars.example .dev.vars
npx wrangler dev
```

fill in `.dev.vars` locally. never commit it. the live whoop callback must match a redirect registered with whoop; local server startup alone does not test that flow.

dates currently use america/chicago. sleep and recovery belong to the wake-up date. cycle dates use the cycle start plus 12 hours, which is a heuristic. change and test the date handling if you need a different timezone or day assignment.
