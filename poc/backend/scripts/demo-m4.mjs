#!/usr/bin/env node
/**
 * M4-10 – reproducible two-index search demo.
 *
 * Documented sequence (plan §9.2):
 *   1. Draft and publish; the commit moment is recorded
 *   2. Both indexes become searchable; the publish → searchable delay is measured
 *   3. Title, summary, tag and category searches, then the public detail
 *   4. B is taken away; a further change still reaches A
 *   5. A is taken away and B returns: the read falls back to B, and B catches up
 *   6. A withdrawal is left as a stale hit in one index; the database filter
 *      removes it and the detail route answers 404
 *   7. Both instances are restored and both hold the same end state
 *
 * Identity: the M2 L2 path (a real Authentik access token) is still pending, so
 * this runner drives the content service directly with an explicit publisher
 * context, exactly as `demo:m3` does. It therefore proves the **search path**
 * end to end; the full "log in → publish → search" business demo stays
 * `M2 L2 pending` and the report says so in its own line.
 *
 * Instance outages are injected by an in-process proxy in front of each
 * Meilisearch endpoint, so the application genuinely cannot reach the instance.
 * Set DEMO_MEILI_DIRECT=on to talk to the endpoints directly and stop the
 * containers by hand instead.
 *
 *   npm run demo:m4
 *
 * Requires FEATURE_SEARCH=on, NATS_URL, DATABASE_URL and the four MEILI_* keys.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../dist/database.js';
import { ContentService } from '../dist/content/content.service.js';
import { OutboxRepository } from '../dist/outbox/outbox.repository.js';
import {
  normalizeCreateCommand, normalizeVersionedCommand,
} from '../dist/contracts/http.js';
import { normalizeCatalogSearchQuery } from '../dist/contracts/search.js';
import { DEMO_CONTENT } from '../dist/content/demo-fixture.js';

function note(step, detail = {}) {
  process.stdout.write(`${JSON.stringify({ event: 'demo_step', step, ...detail })}\n`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      last = 'condition false';
    } catch (error) {
      last = error.message;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label} (${last})`);
}

/** Switchable HTTP proxy; `down` is indistinguishable from a stopped instance. */
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

async function meiliDocument(url, key, indexUid, id) {
  const response = await fetch(new URL(`/indexes/${indexUid}/documents/${id}`, url), {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  return response.ok ? response.json() : null;
}

async function meiliSeed(url, key, indexUid, document) {
  const response = await fetch(new URL(`/indexes/${indexUid}/documents?primaryKey=id`, url), {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify([document]),
    signal: AbortSignal.timeout(8000),
  });
  expect(response.ok, `seeding a stale document answered ${response.status}`);
  const { taskUid } = await response.json();
  await waitFor('the stale seed task', async () => {
    const task = await fetch(new URL(`/tasks/${taskUid}`, url), {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return task.ok && (await task.json()).status === 'succeeded';
  }, 20_000);
}

const direct = process.env.DEMO_MEILI_DIRECT === 'on';
const realA = { url: process.env.MEILI_A_URL ?? '', key: process.env.MEILI_A_KEY ?? '' };
const realB = { url: process.env.MEILI_B_URL ?? '', key: process.env.MEILI_B_KEY ?? '' };

if (process.env.FEATURE_SEARCH !== 'on' || !process.env.NATS_URL || !realA.url || !realB.url) {
  process.stderr.write(`${JSON.stringify({
    event: 'demo_failed',
    reason: 'FEATURE_SEARCH=on, NATS_URL, MEILI_A_URL/KEY and MEILI_B_URL/KEY are required',
  })}\n`);
  process.exit(1);
}

// The workers and the relay must not start before the proxies exist.
process.env.RELAY_AUTO_START = 'off';
process.env.SEARCH_AUTO_START = 'off';

const proxyA = direct ? null : await startProxy(realA.url);
const proxyB = direct ? null : await startProxy(realB.url);
if (proxyA) process.env.MEILI_A_URL = proxyA.url;
if (proxyB) process.env.MEILI_B_URL = proxyB.url;

const { AppModule } = await import('../dist/app.module.js');
const { OutboxRelay } = await import('../dist/messaging/relay.js');
const { SearchRegistry } = await import('../dist/search/search.registry.js');
const { SearchService } = await import('../dist/search/search.service.js');
const { SearchState } = await import('../dist/search/worker.state.js');

const appContext = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
  abortOnError: false,
});
let failure = null;

try {
  const config = appContext.get(ConfigService);
  const database = appContext.get(DatabaseService);
  const content = appContext.get(ContentService);
  const outbox = appContext.get(OutboxRepository);
  const relay = appContext.get(OutboxRelay);
  const registry = appContext.get(SearchRegistry);
  const search = appContext.get(SearchService);
  const state = appContext.get(SearchState);
  const indexUid = config.getOrThrow('MEILI_INDEX_UID');

  const operation = {
    actor: { sub: `demo-publisher-${randomUUID().slice(0, 8)}`, roles: ['publisher'] },
    correlationId: `demo-m4-${randomUUID().slice(0, 8)}`,
  };
  const marker = `m4demo${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const drained = async () => {
    const rows = await outbox.pending(database.db, 100);
    return rows.length === 0
      && ['a', 'b'].every(alias => state.get(alias).inFlightEventId === null);
  };
  const searchIds = async (q, extra = {}) => {
    const view = await search.search(normalizeCatalogSearchQuery({ q, ...extra }));
    return view.items.map(item => item.id);
  };

  relay.start();
  registry.startAll();
  await waitFor('both index workers to finish bootstrapping', async () =>
    ['a', 'b'].every(alias => state.get(alias).state === 'idle'));
  note('workers_ready', { indexUid, durables: ['a', 'b'].map(alias => state.get(alias).durable) });

  /* 1–2. publish, then measure how long it takes to become searchable */
  const draft = await content.create(
    normalizeCreateCommand({
      ...DEMO_CONTENT,
      title: `${DEMO_CONTENT.title} – ${marker}`,
      tags: [...DEMO_CONTENT.tags],
    }),
    operation,
  );
  const committedAt = Date.now();
  const published = await content.publish(
    draft.id, normalizeVersionedCommand({ expectedVersion: 1 }), operation,
  );
  note('published', { id: published.id, version: published.version });

  await waitFor('index A to hold the document', async () =>
    (await meiliDocument(realA.url, realA.key, indexUid, published.id)) !== null);
  const searchableInA = Date.now() - committedAt;
  await waitFor('index B to hold the document', async () =>
    (await meiliDocument(realB.url, realB.key, indexUid, published.id)) !== null);
  const searchableInB = Date.now() - committedAt;
  note('searchable', { publishToSearchableMsA: searchableInA, publishToSearchableMsB: searchableInB });

  /* 3. title, summary, tag and category searches, then the public detail */
  expect((await searchIds(marker)).includes(published.id), 'the title marker is not searchable');
  expect((await searchIds('élővilágáról')).includes(published.id), 'the summary is not searchable');
  expect((await searchIds('természetfilm')).includes(published.id), 'the tag is not searchable');
  expect(
    (await searchIds(marker, { category: 'film' })).includes(published.id),
    'the category filter removed a matching content',
  );
  expect((await searchIds(marker, { category: 'sport' })).length === 0, 'the category filter did not apply');
  const detail = await content.findPublished(published.id);
  expect(detail.id === published.id, 'the public detail did not return the published content');
  note('searches_ok');

  /* 4. B away, a further change still reaches A */
  proxyB?.setMode('down');
  const second = await content.create(
    normalizeCreateCommand({
      ...DEMO_CONTENT,
      title: `Második ${marker} tartalom`,
      tags: [...DEMO_CONTENT.tags],
    }),
    operation,
  );
  const secondPublished = await content.publish(
    second.id, normalizeVersionedCommand({ expectedVersion: 1 }), operation,
  );
  await waitFor('A to index the second content while B is away', async () =>
    (await meiliDocument(realA.url, realA.key, indexUid, secondPublished.id)) !== null);
  expect(
    (await meiliDocument(realB.url, realB.key, indexUid, secondPublished.id)) === null,
    'B indexed while it was supposed to be unreachable',
  );
  note('b_down_a_progressed', { id: secondPublished.id, bState: state.get('b').state });

  /* 5. A away, B returns: fallback read, then B catches up */
  proxyB?.setMode('pass');
  proxyA?.setMode('down');
  const viaFallback = await searchIds(marker);
  expect(viaFallback.includes(published.id), 'the B fallback did not return the first content');
  note('fallback_read_ok', { returned: viaFallback.length });

  await waitFor('B to catch up', async () =>
    (await meiliDocument(realB.url, realB.key, indexUid, secondPublished.id)) !== null);
  note('b_caught_up');
  proxyA?.setMode('pass');
  await waitFor('both durables to drain', drained);

  /* 6. withdraw, then a deliberately stale hit in B */
  const withdrawn = await content.withdraw(
    published.id,
    normalizeVersionedCommand({ expectedVersion: published.version }),
    operation,
  );
  await waitFor('both indexes to drop the withdrawn content', async () =>
    (await meiliDocument(realA.url, realA.key, indexUid, published.id)) === null
    && (await meiliDocument(realB.url, realB.key, indexUid, published.id)) === null);
  note('withdrawn', { id: withdrawn.id, version: withdrawn.version });

  await meiliSeed(realB.url, realB.key, indexUid, {
    id: published.id,
    title: `${DEMO_CONTENT.title} – ${marker}`,
    summary: DEMO_CONTENT.summary,
    category: DEMO_CONTENT.category,
    tags: [...DEMO_CONTENT.tags],
    aggregateVersion: published.version,
  });
  proxyA?.setMode('down');
  const staleIds = await searchIds(marker);
  proxyA?.setMode('pass');
  expect(!staleIds.includes(published.id), 'a withdrawn content leaked through a stale index hit');
  let detailStatus = 200;
  try {
    await content.findPublished(published.id);
  } catch (error) {
    detailStatus = error.status ?? 500;
  }
  expect(detailStatus === 404, `the withdrawn detail answered ${detailStatus}, expected 404`);
  note('stale_hit_filtered', { detailStatus });

  /* 7. both instances restored, same end state */
  await waitFor('both durables to drain again', drained);
  const endA = await meiliDocument(realA.url, realA.key, indexUid, secondPublished.id);
  const endB = await meiliDocument(realB.url, realB.key, indexUid, secondPublished.id);
  expect(endA !== null && endB !== null, 'the surviving content is missing from an index');
  expect(
    JSON.stringify(endA) === JSON.stringify(endB),
    'the two indexes disagree about the surviving content',
  );
  note('end_state_identical', { id: secondPublished.id, aggregateVersion: endA.aggregateVersion });

  note('demo_complete', {
    identity: 'M2 L2 pending: the search path is proved without a real Authentik access token',
    publishToSearchableMsA: searchableInA,
    publishToSearchableMsB: searchableInB,
  });
} catch (error) {
  failure = error;
} finally {
  try {
    await appContext.get(SearchRegistry).stopAll(5000);
  } catch { /* already down */ }
  try {
    await appContext.get(OutboxRelay).stop(5000);
  } catch { /* already down */ }
  await appContext.close().catch(() => undefined);
  await proxyA?.close();
  await proxyB?.close();
}

if (failure) {
  process.stderr.write(`${JSON.stringify({ event: 'demo_failed', reason: failure.message })}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    event: 'demo_result',
    status: 'PASS',
    note: 'M2 L2 pending — run with a real Authentik access token for the full business demo',
  })}\n`);
}
