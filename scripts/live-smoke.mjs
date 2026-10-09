import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/live-smoke.mjs https://your-worker.workers.dev');
const serverUrl = new URL(target);
if (serverUrl.protocol !== 'https:' || serverUrl.username || serverUrl.password || serverUrl.pathname !== '/' || serverUrl.search || serverUrl.hash) {
  throw new Error('Pass the HTTPS origin of your own deployment, without a path, query, or credentials.');
}
const base = serverUrl.origin;
const { ACCESS_PASSWORD } = JSON.parse(await readFile('.wrangler/setup/secrets.json', 'utf8'));
const redirect = 'http://localhost:9876/callback';
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(16).toString('hex');
const registration = await fetch(`${base}/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'WHOOP deployment verification', redirect_uris: [redirect],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
});
assert.equal(registration.status, 201, 'Client registration');
const { client_id } = await registration.json();
const query = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: redirect,
  state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: `${base}/mcp` });
for (const headers of [{}, { Authorization: 'Bearer invalid' }]) {
  assert.equal((await fetch(`${base}/mcp`, { headers })).status, 401);
}
const authorize = password => fetch(`${base}/authorize`, { method: 'POST', redirect: 'manual',
  body: new URLSearchParams({ q: `?${query}`, password }) });
assert.equal((await authorize('intentionally-incorrect')).status, 401);
const auth = await authorize(ACCESS_PASSWORD);
assert.equal(auth.status, 302, 'Password authorization');
const callback = new URL(auth.headers.get('location'));
assert.equal(callback.searchParams.get('state'), state);
const tokenResponse = await fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams({
  grant_type: 'authorization_code', client_id, code: callback.searchParams.get('code'), redirect_uri: redirect,
  code_verifier: verifier, resource: `${base}/mcp`,
}) });
assert.equal(tokenResponse.status, 200, 'Token exchange');
const token = await tokenResponse.json();
const client = new Client({ name: 'whoop-live-verification', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } },
  }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  assert.ok(tools.every(t => t.annotations?.readOnlyHint === true));
  console.log('PASS: live OAuth with PKCE, password rejection, bearer rejection, MCP initialization, seven read-only tools.');
  for (const name of ['get_today', 'get_profile']) {
    const result = await client.callTool({ name, arguments: {} });
    if (result.isError) throw new Error(`${name}: ${result.content?.find(c => c.type === 'text')?.text}`);
    const payload = JSON.parse(result.content.find(c => c.type === 'text').text);
    console.log(`PASS: ${name} returned WHOOP data (fields: ${Object.keys(payload).join(', ')}; values withheld).`);
  }
} finally {
  await client.close();
  const revoked = await fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams({
    token: token.refresh_token ?? token.access_token,
    token_type_hint: token.refresh_token ? 'refresh_token' : 'access_token', client_id,
  }) });
  assert.equal(revoked.status, 200, 'Verification grant revocation');
}
