#!/usr/bin/env node
/**
 * M2 demo – HTTP walk with a real Bearer token when Authentik is available.
 *
 * Without E02–E05 (reachable Authentik + issued access token) the script exits
 * with a pending marker instead of faking success:
 *
 *   OIDC_ACCESS_TOKEN=... npm run demo:m2
 *
 * Optional: AUTHENTIK_PUBLIC_URL + AUTHENTIK_POC_USER_PASSWORD for a discovery
 * preflight via authentik-login.mjs.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEMO_CONTENT, DEMO_EDIT, DEMO_SLUG } from '../dist/content/demo-fixture.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.OIDC_ACCESS_TOKEN;
const databaseUrl = process.env.DATABASE_URL;
const issuer = process.env.OIDC_ISSUER_URL;
const audience = process.env.OIDC_AUDIENCE || 'poc-backend-api';

/**
 * Reports a failure and exits. Used only before any resource exists — inside
 * the main try/catch the failure is recorded and reported after the `finally`
 * block, because `process.exit()` skips `finally` and would leak the child
 * process and the temporary env directory (R04).
 */
function fail(code, detail, extra = {}) {
  process.stderr.write(JSON.stringify({ event: 'demo_m2_failed', code, detail, ...extra }) + '\n');
  process.exit(1);
}

if (!databaseUrl) {
  fail('missing_configuration', 'DATABASE_URL is required.');
}

if (!token || !issuer) {
  fail('pending_l2', 'OIDC_ACCESS_TOKEN and OIDC_ISSUER_URL are required for demo:m2.', {
    pending: ['E02', 'E03', 'E04', 'E05'],
    hint: 'Obtain an access token via Authentik (scripts/authentik-login.mjs) then re-run.',
  });
}

const directory = await mkdtemp(join(tmpdir(), 'tv2-demo-m2-'));
const envFile = join(directory, '.env');
// PORT=0 (dynamic port) is only accepted with NODE_ENV=test by the shared
// config validator, and every script that spawns a child app uses that pair.
// Writing `development` here made the demo die before its first request (R04).
await writeFile(envFile, [
  'NODE_ENV=test',
  'PORT=0',
  'LOG_LEVEL=info',
  `DATABASE_URL=${databaseUrl}`,
  'FEATURE_IDENTITY=on',
  'FEATURE_OUTBOX_RELAY=off',
  'FEATURE_SEARCH=off',
  'FEATURE_MEDIA=off',
  `OIDC_ISSUER_URL=${issuer}`,
  `OIDC_AUDIENCE=${audience}`,
  process.env.OIDC_JWKS_URI ? `OIDC_JWKS_URI=${process.env.OIDC_JWKS_URI}` : '',
].filter(Boolean).join('\n'));

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, ENV_FILE: envFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

let url;
let failure = null;
try {
  const deadline = Date.now() + 30_000;
  while (!url && Date.now() < deadline) {
    for (const line of output.split('\n')) {
      try {
        const item = JSON.parse(line);
        if (item.event === 'listening') url = item.url;
      } catch { /* ignore */ }
    }
    if (child.exitCode !== null) throw new Error(`process exited: ${output}`);
    if (!url) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!url) throw new Error('listen timeout');

  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-correlation-id': `demo-m2-${randomUUID()}`,
  };
  const request = async (method, path, body) => {
    // The body is attached only when there is one: a GET carrying a body is
    // invalid fetch usage and the lint gate rejects it.
    const init = { method, headers, signal: AbortSignal.timeout(8000) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(url + path, init);
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };

  const me = await request('GET', '/me');
  if (me.status !== 200) throw new Error(`/me failed: ${me.status}`);
  process.stdout.write(JSON.stringify({ event: 'demo_step', step: 'me', sub: me.body.sub, roles: me.body.roles }) + '\n');

  const draft = await request('POST', '/admin/contents', { ...DEMO_CONTENT, tags: [...DEMO_CONTENT.tags] });
  if (draft.status !== 201) throw new Error(`create failed: ${draft.status}`);
  process.stdout.write(JSON.stringify({ event: 'demo_step', step: 'draft', id: draft.body.id, version: draft.body.version }) + '\n');

  const edited = await request('PATCH', `/admin/contents/${draft.body.id}`, {
    expectedVersion: 1, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags],
  });
  if (edited.status !== 200) throw new Error(`edit failed: ${edited.status}`);

  const published = await request('POST', `/admin/contents/${draft.body.id}/publish`, { expectedVersion: 2 });
  if (published.status !== 200 || published.body.slug !== DEMO_SLUG) {
    throw new Error(`publish failed: ${published.status}`);
  }
  process.stdout.write(JSON.stringify({ event: 'demo_step', step: 'publish', slug: published.body.slug }) + '\n');

  const catalog = await fetch(`${url}/catalog/contents/${draft.body.id}`, { signal: AbortSignal.timeout(4000) });
  if (catalog.status !== 200) throw new Error(`catalog failed: ${catalog.status}`);

  const withdrawn = await request('POST', `/admin/contents/${draft.body.id}/withdraw`, { expectedVersion: 3 });
  if (withdrawn.status !== 200) throw new Error(`withdraw failed: ${withdrawn.status}`);
  process.stdout.write(JSON.stringify({ event: 'demo_step', step: 'withdraw', version: withdrawn.body.version }) + '\n');
  process.stdout.write(JSON.stringify({ event: 'demo_m2_passed' }) + '\n');
} catch (error) {
  failure = { code: 'demo_failed', detail: error.message };
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
  await rm(directory, { recursive: true, force: true });
}

if (failure) fail(failure.code, failure.detail, { output: output.slice(-500) });
