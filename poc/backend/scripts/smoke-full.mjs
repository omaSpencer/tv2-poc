#!/usr/bin/env node
/**
 * Full-profile smoke: M2 identity gate + M3 NATS relay + M4 two-index search.
 *
 *   npm run smoke:full
 *
 * Isolation contract (R01). The runner NEVER relays out of an existing
 * database. It takes the supplied URL as a *server* coordinate only, creates
 * its own `poc_smoke_<run>_test` database on that server, migrates it, runs
 * every child application against it, and drops it afterwards. A normal
 * `DATABASE_URL` therefore cannot be emptied into a throwaway stream and
 * marked delivered. The JetStream stream is per-run in the same way.
 *
 * Evidence contract (R09). `PASS` means the named behaviour was observed.
 * Checks that need an absent dependency report `PENDING` and are counted
 * separately; a pending check never becomes a passing gate result. The relay
 * case proves an actual delivery: its own fixture event, a publish ACK, the
 * `delivered_at` mark, and the stream envelope byte-compared to the row the
 * event was built from, and the M4 case proves a real outbox → stream → A/B
 * index → search path plus an A/B outage, a catch-up and the database filter
 * that removes a stale index hit.
 *
 * Instance outages are injected at the network boundary by an in-process proxy
 * in front of each Meilisearch endpoint. From the application's side that is
 * indistinguishable from the process being stopped, and it keeps the runner
 * from having to own the container lifecycle of somebody else's stack.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { connect } from '@nats-io/transport-node';
import { jetstreamManager } from '@nats-io/jetstream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ID = randomUUID().slice(0, 8);
const SMOKE_DATABASE = `poc_smoke_${RUN_ID}_test`;
const results = [];
const cleanups = [];

/** status: 'pass' | 'fail' | 'pending' */
function record(name, status, reason = '') {
  results.push({ name, status, reason });
  process.stdout.write(`${status.toUpperCase().padEnd(7)} ${name}${reason ? ` – ${reason}` : ''}\n`);
}

class AssertionFailed extends Error {}
class Pending extends Error {}
function check(condition, message) {
  if (!condition) throw new AssertionFailed(message);
}
function pending(message) {
  throw new Pending(message);
}

async function testCase(name, work) {
  try {
    await work();
    record(name, 'pass');
  } catch (error) {
    if (error instanceof Pending) {
      record(name, 'pending', error.message);
      return;
    }
    record(name, 'fail', error instanceof AssertionFailed ? error.message : `unexpected failure: ${error.message}`);
  }
}

async function waitFor(description, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
      last = 'condition false';
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new AssertionFailed(`timed out waiting for ${description} (${last})`);
}

async function startApp(envLines) {
  const directory = await mkdtemp(join(tmpdir(), 'tv2-full-'));
  const envFile = join(directory, '.env');
  await writeFile(envFile, envLines.join('\n'));
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, ENV_FILE: envFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let url;
  await waitFor('application listen', async () => {
    for (const line of output.split('\n')) {
      try {
        const item = JSON.parse(line);
        if (item.event === 'listening') {
          url = item.url;
          return true;
        }
      } catch { /* ignore */ }
    }
    if (child.exitCode !== null) throw new Error(`process exited: ${output}`);
    return false;
  });
  return {
    url,
    output: () => output,
    child,
    async dispose() {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/* ------------------------------------------------------- disposable database */

/**
 * The supplied URL identifies the *server*; the database part of it is only a
 * connection coordinate and is never written to. Everything this runner does
 * happens in a database it created itself and drops again.
 */
function smokeDatabaseUrl(serverUrl) {
  const url = new URL(serverUrl);
  url.pathname = `/${SMOKE_DATABASE}`;
  return url.toString();
}

function maintenanceUrl(serverUrl) {
  const url = new URL(serverUrl);
  url.pathname = '/postgres';
  return url.toString();
}

async function withMaintenance(serverUrl, work) {
  const client = new pg.Client({ connectionString: maintenanceUrl(serverUrl) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function createSmokeDatabase(serverUrl) {
  await withMaintenance(serverUrl, async client => {
    await client.query(`CREATE DATABASE "${SMOKE_DATABASE}"`);
  });
  cleanups.push(async () => {
    await withMaintenance(serverUrl, async client => {
      await client.query(`DROP DATABASE IF EXISTS "${SMOKE_DATABASE}" WITH (FORCE)`);
    });
  });
  const target = smokeDatabaseUrl(serverUrl);
  const migrate = spawnSync('npx', ['drizzle-kit', 'migrate'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: target },
  });
  check(migrate.status === 0, `migrating the smoke database failed: ${(migrate.stderr || '').trim().slice(0, 300)}`);
  return target;
}

async function query(databaseUrl, text, values = []) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

/** One published content plus its outbox row — the only event this run owns. */
async function insertFixtureEvent(databaseUrl, options = {}) {
  const contentId = randomUUID();
  const eventId = randomUUID();
  const occurredAt = new Date();
  const correlationId = `smoke-full-${RUN_ID}`;
  const suffix = randomUUID().slice(0, 8);
  // A distinctive word so the search assertion cannot match anything else.
  const title = options.word ? `Smoke fixture ${options.word} ${RUN_ID}` : 'Smoke fixture';
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into content
         (id, slug, title, summary, category, media_asset_id, tags, status, version,
          created_at, updated_at, published_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, 'published', 1, $8, $8, $8, $9, $9)`,
      [
        contentId, `smoke-full-${RUN_ID}-${suffix}`, title, 'Smoke fixture summary',
        'egyeb', `smoke-asset-${RUN_ID}`, ['smoke'], occurredAt, `smoke:${RUN_ID}`,
      ],
    );
    await client.query(
      `insert into outbox_event
         (event_id, schema_version, event_type, aggregate_id, aggregate_version,
          occurred_at, correlation_id, payload)
       values ($1, 1, 'content.published', $2, 1, $3, $4, $5::jsonb)`,
      [eventId, contentId, occurredAt, correlationId, JSON.stringify({ status: 'published' })],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return { contentId, eventId, correlationId, title };
}

/** Withdraws a fixture the same way the application would: row plus outbox row. */
async function withdrawFixture(databaseUrl, fixture) {
  const occurredAt = new Date();
  const eventId = randomUUID();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `update content
          set status = 'withdrawn', version = version + 1, withdrawn_at = $2, updated_at = $2
        where id = $1`,
      [fixture.contentId, occurredAt],
    );
    await client.query(
      `insert into outbox_event
         (event_id, schema_version, event_type, aggregate_id, aggregate_version,
          occurred_at, correlation_id, payload)
       values ($1, 1, 'content.withdrawn', $2,
               (select version from content where id = $2), $3, $4, $5::jsonb)`,
      [eventId, fixture.contentId, occurredAt, fixture.correlationId, JSON.stringify({ status: 'withdrawn' })],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  return { eventId };
}

/* ------------------------------------------------------------- Meilisearch */

/**
 * Direct REST access to a real instance, bypassing the proxy: the assertions
 * must observe the actual end state, not whatever the failure injection in
 * front of it is currently doing.
 */
async function meiliFetch(endpoint, path, init = {}) {
  return fetch(new URL(path, endpoint.url), {
    ...init,
    headers: { authorization: `Bearer ${endpoint.key}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(8000),
  });
}

async function meiliDocument(endpoint, indexUid, id) {
  const response = await meiliFetch(endpoint, `/indexes/${indexUid}/documents/${id}`);
  if (!response.ok) return null;
  return response.json();
}

async function meiliAwaitTask(endpoint, taskUid, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await meiliFetch(endpoint, `/tasks/${taskUid}`);
    if (response.ok) {
      const task = await response.json();
      if (task.status === 'succeeded') return task;
      if (task.status === 'failed' || task.status === 'canceled') {
        throw new AssertionFailed(`Meilisearch task ${taskUid} ended as ${task.status}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new AssertionFailed(`Meilisearch task ${taskUid} did not finish in time`);
}

/** Stages a stale hit directly, so the database filter can be proved. */
async function meiliSeed(endpoint, indexUid, document) {
  const response = await meiliFetch(endpoint, `/indexes/${indexUid}/documents?primaryKey=id`, {
    method: 'POST',
    body: JSON.stringify([document]),
  });
  check(response.ok, `seeding a stale document answered ${response.status}`);
  await meiliAwaitTask(endpoint, (await response.json()).taskUid);
}

/** Removes only the index this run created. */
async function dropSmokeIndex(endpoint, indexUid) {
  if (!endpoint.url || !endpoint.key) return;
  if (!indexUid.startsWith('contents_smoke_')) return;
  try {
    const response = await meiliFetch(endpoint, `/indexes/${indexUid}`, { method: 'DELETE' });
    if (response.ok) await meiliAwaitTask(endpoint, (await response.json()).taskUid).catch(() => undefined);
  } catch { /* never created */ }
}

function sameMeiliEndpoint(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const path = url => url.pathname.replace(/\/+$/, '');
    return a.protocol === b.protocol && a.host.toLowerCase() === b.host.toLowerCase() && path(a) === path(b);
  } catch {
    return false;
  }
}

/**
 * Minimal switchable proxy. `down` destroys the socket, which is what a client
 * sees when the instance behind it goes away.
 */
async function startProxy(target) {
  let mode = 'pass';
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    if (mode === 'down') {
      req.socket.destroy();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && !['host', 'connection', 'content-length'].includes(key)) {
        headers.set(key, value);
      }
    }
    try {
      const upstream = await fetch(new URL(req.url ?? '/', target), {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(text);
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"message":"proxy failure","code":"internal","type":"internal","link":""}');
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    setMode: next => {
      mode = next;
      if (next === 'down') for (const socket of sockets) socket.destroy();
    },
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

/** Key-order independent comparison of two decoded JSON envelopes. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

/** Rebuilds the wire envelope from the stored row — the relay's own mapping. */
function envelopeFromDbRow(row) {
  return {
    eventId: row.event_id,
    schemaVersion: row.schema_version,
    eventType: row.event_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: new Date(row.occurred_at).toISOString(),
    correlationId: row.correlation_id,
    payload: row.payload,
  };
}

/* ------------------------------------------------------------------- preflight */

const serverUrl = process.env.SMOKE_EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;
const natsUrl = process.env.SMOKE_EXTERNAL_NATS_URL || process.env.NATS_URL;
const authentikUrl = (process.env.AUTHENTIK_PUBLIC_URL || '').replace(/\/$/, '');
const meiliA = {
  url: process.env.SMOKE_EXTERNAL_MEILI_A_URL || process.env.MEILI_A_URL || '',
  key: process.env.SMOKE_EXTERNAL_MEILI_A_KEY || process.env.MEILI_A_KEY || '',
};
const meiliB = {
  url: process.env.SMOKE_EXTERNAL_MEILI_B_URL || process.env.MEILI_B_URL || '',
  key: process.env.SMOKE_EXTERNAL_MEILI_B_KEY || process.env.MEILI_B_KEY || '',
};
let databaseUrl = null;

await testCase('full.preflight disposable database and nats', async () => {
  check(Boolean(serverUrl), 'DATABASE_URL or SMOKE_EXTERNAL_DATABASE_URL is required');
  check(Boolean(natsUrl), 'NATS_URL or SMOKE_EXTERNAL_NATS_URL is required');
  const nc = await connect({ servers: natsUrl, name: `smoke-full-${RUN_ID}` });
  try {
    await jetstreamManager(nc);
  } finally {
    await nc.close();
  }
  databaseUrl = await createSmokeDatabase(serverUrl);
  // Belt and braces: the target must be the database this run created.
  check(new URL(databaseUrl).pathname === `/${SMOKE_DATABASE}`, 'the smoke target is not the generated database');
  check(
    new URL(databaseUrl).toString() !== new URL(serverUrl).toString(),
    'the smoke target must differ from the supplied database URL',
  );
  const rows = await query(databaseUrl, 'select count(*)::int as count from outbox_event');
  check(rows.rows[0].count === 0, 'the freshly created smoke database is not empty');
});

/* ------------------------------------------------------------------------- M2 */

await testCase('full.m2 identity boots with OIDC keys (IdP may be down)', async () => {
  check(Boolean(databaseUrl), 'preflight did not produce a smoke database');
  const app = await startApp([
    'NODE_ENV=test',
    'PORT=0',
    'LOG_LEVEL=info',
    `DATABASE_URL=${databaseUrl}`,
    'FEATURE_IDENTITY=on',
    'FEATURE_OUTBOX_RELAY=off',
    'FEATURE_SEARCH=off',
    'FEATURE_MEDIA=off',
    'OIDC_ISSUER_URL=https://idp.invalid/application/o/poc-backend/',
    'OIDC_AUDIENCE=poc-backend-api',
  ]);
  try {
    const ready = await fetch(`${app.url}/health/ready`, { signal: AbortSignal.timeout(4000) });
    check(ready.status === 200, `ready answered ${ready.status}`);
    const admin = await fetch(`${app.url}/admin/contents/${randomUUID()}`, { signal: AbortSignal.timeout(4000) });
    check(admin.status === 401, `admin without token answered ${admin.status}, expected 401`);
    check(admin.headers.get('www-authenticate') === 'Bearer', 'missing WWW-Authenticate');
    const me = await fetch(`${app.url}/me`, { signal: AbortSignal.timeout(4000) });
    check(me.status === 401, `/me without token answered ${me.status}`);
  } finally {
    await app.dispose();
  }
});

await testCase('full.m2 L2 Authentik discovery', async () => {
  if (!authentikUrl) {
    pending('AUTHENTIK_PUBLIC_URL is not set; E02–E05 remain open');
  }
  const discovery = `${authentikUrl}/application/o/poc-backend/.well-known/openid-configuration`;
  const response = await fetch(discovery, { signal: AbortSignal.timeout(5000) });
  check(response.ok, `discovery HTTP ${response.status}`);
  const body = await response.json();
  check(typeof body.issuer === 'string' && body.issuer.length > 0, 'discovery issuer missing');
  check(typeof body.jwks_uri === 'string' && body.jwks_uri.length > 0, 'discovery jwks_uri missing');
  process.stdout.write(JSON.stringify({
    event: 'authentik_discovery',
    issuer: body.issuer,
    jwks_uri: body.jwks_uri,
  }) + '\n');
});

/* ------------------------------------------------------------------------- M3 */

await testCase('full.m3 relay delivers one publish', async () => {
  check(Boolean(databaseUrl) && Boolean(natsUrl), 'preflight did not complete');
  const stream = `SMOKE_${RUN_ID}`;
  const subject = `poc.smoke.${RUN_ID}.changed.v1`;
  const fixture = await insertFixtureEvent(databaseUrl);

  const app = await startApp([
    'NODE_ENV=test',
    'PORT=0',
    'LOG_LEVEL=info',
    `DATABASE_URL=${databaseUrl}`,
    'FEATURE_IDENTITY=off',
    'FEATURE_OUTBOX_RELAY=on',
    'FEATURE_SEARCH=off',
    'FEATURE_MEDIA=off',
    `NATS_URL=${natsUrl}`,
    `NATS_STREAM=${stream}`,
    `NATS_SUBJECT=${subject}`,
    'NATS_RELAY_POLL_MS=100',
    'RELAY_AUTO_START=on',
  ]);
  try {
    const ready = await fetch(`${app.url}/health/ready`, { signal: AbortSignal.timeout(4000) });
    check(ready.status === 200, `ready answered ${ready.status}`);

    // 1. The row this run created must be marked delivered — not "the process
    //    is still alive", which a halted relay also satisfies.
    const delivered = await waitFor('the fixture event to be marked delivered', async () => {
      const rows = await query(
        databaseUrl,
        'select * from outbox_event where event_id = $1',
        [fixture.eventId],
      );
      const row = rows.rows[0];
      return row && row.delivered_at !== null ? row : false;
    }, 20_000);

    // 2. Nothing else may be pending: the relay owned exactly this one event.
    const pendingRows = await query(
      databaseUrl,
      'select count(*)::int as count from outbox_event where delivered_at is null',
    );
    check(pendingRows.rows[0].count === 0, `${pendingRows.rows[0].count} events stayed pending`);

    // 3. The stream must carry exactly that envelope, byte for byte.
    const nc = await connect({ servers: natsUrl, name: `smoke-full-verify-${RUN_ID}` });
    try {
      const jsm = await jetstreamManager(nc);
      const info = await jsm.streams.info(stream);
      check(info.state.messages === 1, `the stream holds ${info.state.messages} messages, expected 1`);
      const message = await jsm.streams.getMessage(stream, { seq: info.state.first_seq });
      check(message !== null, 'the stream did not return the stored message');
      check(message.subject === subject, `message published to ${message.subject}, expected ${subject}`);
      const onStream = JSON.parse(Buffer.from(message.data).toString('utf8'));
      const fromDb = envelopeFromDbRow(delivered);
      check(
        JSON.stringify(canonical(onStream)) === JSON.stringify(canonical(fromDb)),
        `stream envelope differs from the stored row: ${JSON.stringify(onStream)} vs ${JSON.stringify(fromDb)}`,
      );
      check(onStream.eventId === fixture.eventId, 'the delivered envelope is not the fixture event');
      check(onStream.correlationId === fixture.correlationId, 'the correlation id did not survive the relay');
    } finally {
      await nc.close();
    }

    // 4. The delivery must also be visible to an operator.
    check(app.output().includes('relay_delivered'), 'no relay_delivered log line');
    check(app.child.exitCode === null, 'relay process exited early');
  } finally {
    await app.dispose();
    try {
      const nc = await connect({ servers: natsUrl });
      const jsm = await jetstreamManager(nc);
      try { await jsm.streams.delete(stream); } catch { /* ignore */ }
      try { await jsm.streams.delete(`${stream}_DLQ`); } catch { /* ignore */ }
      await nc.close();
    } catch { /* ignore */ }
  }
});

/* ------------------------------------------------------------------------- M4 */

await testCase('full.m4 two-index search, outage, catch-up and stale filtering', async () => {
  check(Boolean(databaseUrl) && Boolean(natsUrl), 'preflight did not complete');
  if (!meiliA.url || !meiliA.key || !meiliB.url || !meiliB.key) {
    pending('MEILI_A_URL/KEY and MEILI_B_URL/KEY are required for the M4 gate');
  }
  if (sameMeiliEndpoint(meiliA.url, meiliB.url)) {
    pending('MEILI_A_URL and MEILI_B_URL point at the same instance; an A/B outage cannot be proved');
  }

  const stream = `SMOKE4_${RUN_ID}`;
  const subject = `poc.smoke4.${RUN_ID}.changed.v1`;
  const indexUid = `contents_smoke_${RUN_ID}`;
  const durables = [`${stream}-search-a-v1`, `${stream}-search-b-v1`];

  const proxyA = await startProxy(meiliA.url);
  const proxyB = await startProxy(meiliB.url);
  // Only ever touches the index this run created.
  cleanups.push(() => dropSmokeIndex(meiliA, indexUid));
  cleanups.push(() => dropSmokeIndex(meiliB, indexUid));

  const app = await startApp([
    'NODE_ENV=test',
    'PORT=0',
    'LOG_LEVEL=info',
    `DATABASE_URL=${databaseUrl}`,
    'FEATURE_IDENTITY=off',
    'FEATURE_OUTBOX_RELAY=on',
    'FEATURE_SEARCH=on',
    'FEATURE_MEDIA=off',
    `NATS_URL=${natsUrl}`,
    `NATS_STREAM=${stream}`,
    `NATS_SUBJECT=${subject}`,
    'NATS_RELAY_POLL_MS=100',
    'RELAY_AUTO_START=on',
    `MEILI_A_URL=${proxyA.url}`,
    `MEILI_A_KEY=${meiliA.key}`,
    `MEILI_B_URL=${proxyB.url}`,
    `MEILI_B_KEY=${meiliB.key}`,
    `MEILI_INDEX_UID=${indexUid}`,
    'MEILI_TASK_POLL_MS=50',
    'SEARCH_TIMEOUT_MS=1000',
  ]);

  const search = async (term) => {
    const response = await fetch(
      `${app.url}/catalog/search?q=${encodeURIComponent(term)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  const drained = async () => {
    const nc = await connect({ servers: natsUrl, name: `smoke4-drain-${RUN_ID}` });
    try {
      const jsm = await jetstreamManager(nc);
      for (const durable of durables) {
        const info = await jsm.consumers.info(stream, durable);
        if (info.num_pending !== 0 || info.num_ack_pending !== 0) return false;
      }
      return true;
    } finally {
      await nc.close();
    }
  };
  const durableBacklog = async (durable) => {
    const nc = await connect({ servers: natsUrl, name: `smoke4-lag-${RUN_ID}` });
    try {
      const jsm = await jetstreamManager(nc);
      const info = await jsm.consumers.info(stream, durable);
      return info.num_pending + info.num_ack_pending;
    } finally {
      await nc.close();
    }
  };

  try {
    check((await fetch(`${app.url}/health/ready`, { signal: AbortSignal.timeout(4000) })).status === 200,
      'the application did not become ready');

    /* 1. publish → outbox → stream → both indexes → search */
    const first = await insertFixtureEvent(databaseUrl, { word: 'kereshetokincs' });
    await waitFor('both indexes to hold the first fixture', async () =>
      (await meiliDocument(meiliA, indexUid, first.contentId)) !== null
      && (await meiliDocument(meiliB, indexUid, first.contentId)) !== null, 40_000);
    await waitFor('both durables to drain the first fixture', drained, 20_000);
    const found = await search('kereshetokincs');
    check(found.status === 200, `search answered ${found.status}`);
    check(found.body.items.length === 1 && found.body.items[0].id === first.contentId,
      'the published fixture is not searchable');
    check(!('mediaAssetId' in found.body.items[0]), 'an admin field leaked into the search result');

    /* 2. B away: A keeps going, B's durable falls behind */
    proxyB.setMode('down');
    const second = await insertFixtureEvent(databaseUrl, { word: 'masodikkincs' });
    await waitFor('A to index the second fixture while B is away', async () =>
      (await meiliDocument(meiliA, indexUid, second.contentId)) !== null, 40_000);
    check(await durableBacklog(durables[1]) >= 1, "B's durable did not fall behind while B was away");

    /* 3. B returns and catches up in its own order */
    proxyB.setMode('pass');
    await waitFor('B to catch up', async () =>
      (await meiliDocument(meiliB, indexUid, second.contentId)) !== null && await drained(), 60_000);

    /* 4. A away: the read path falls back to B */
    proxyA.setMode('down');
    const viaB = await search('masodikkincs');
    check(viaB.status === 200, `the fallback search answered ${viaB.status}`);
    check(viaB.body.items.length === 1 && viaB.body.items[0].id === second.contentId,
      'the B fallback did not return the expected content');
    proxyA.setMode('pass');

    /* 5. withdraw removes it from both indexes */
    await withdrawFixture(databaseUrl, first);
    await waitFor('both indexes to drop the withdrawn fixture', async () =>
      (await meiliDocument(meiliA, indexUid, first.contentId)) === null
      && (await meiliDocument(meiliB, indexUid, first.contentId)) === null, 40_000);
    const afterWithdraw = await search('kereshetokincs');
    check(afterWithdraw.status === 200 && afterWithdraw.body.items.length === 0,
      'the withdrawn content is still returned by search');

    /* 6. a stale hit that survives in one index must not reach the client */
    await meiliSeed(meiliB, indexUid, {
      id: first.contentId,
      title: `Smoke fixture kereshetokincs ${RUN_ID}`,
      summary: 'Smoke fixture summary',
      category: 'egyeb',
      tags: ['smoke'],
      aggregateVersion: 1,
    });
    check((await meiliDocument(meiliB, indexUid, first.contentId)) !== null, 'the stale seed did not land in B');
    proxyA.setMode('down');
    const stale = await search('kereshetokincs');
    proxyA.setMode('pass');
    check(stale.status === 200, `the stale-hit search answered ${stale.status}`);
    check(stale.body.items.length === 0, 'a withdrawn content leaked through a stale index hit');
    check(stale.body.estimatedTotalHits >= 1, 'the index estimate should still count the stale hit');
    const detail = await fetch(`${app.url}/catalog/contents/${first.contentId}`, { signal: AbortSignal.timeout(4000) });
    check(detail.status === 404, `the withdrawn detail answered ${detail.status}, expected 404`);

    /* 7. the operator view reports both indexes */
    check(app.output().includes('search_task_succeeded'), 'no search_task_succeeded log line');
    check(app.output().includes('search_worker_started'), 'no search_worker_started log line');
    check(!app.output().includes(meiliA.key) && !app.output().includes(meiliB.key),
      'a Meilisearch API key reached the log');
    check(app.child.exitCode === null, 'the application exited early');
  } finally {
    await app.dispose();
    await proxyA.close();
    await proxyB.close();
    try {
      const nc = await connect({ servers: natsUrl });
      const jsm = await jetstreamManager(nc);
      try { await jsm.streams.delete(stream); } catch { /* ignore */ }
      try { await jsm.streams.delete(`${stream}_DLQ`); } catch { /* ignore */ }
      await nc.close();
    } catch { /* ignore */ }
  }
});

/* -------------------------------------------------------------------- teardown */

for (const cleanup of cleanups.reverse()) {
  try {
    await cleanup();
  } catch (error) {
    record('full.cleanup', 'fail', error.message);
  }
}

const failed = results.filter(result => result.status === 'fail');
const passed = results.filter(result => result.status === 'pass');
const pendingChecks = results.filter(result => result.status === 'pending');
process.stdout.write(
  `\nsmoke:full ${failed.length ? 'FAILED' : 'PASSED'}`
  + ` (${passed.length} passed, ${failed.length} failed, ${pendingChecks.length} pending)\n`,
);
if (pendingChecks.length) {
  process.stdout.write('pending checks do not close the gate:\n');
  for (const item of pendingChecks) process.stdout.write(`  - ${item.name}: ${item.reason}\n`);
}
process.exitCode = failed.length ? 1 : 0;
