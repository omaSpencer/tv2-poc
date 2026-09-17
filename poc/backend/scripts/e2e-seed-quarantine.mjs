/**
 * Full-stack E2E fixture for the operator quarantine/replay flow.
 *
 * It deliberately stores only a locator envelope in CONTENT_DLQ. The locator
 * points at a real content event already published by the running outbox relay,
 * so the production replay path must retrieve and validate the original bytes.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jetstream } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import pg from 'pg';
import { buildQuarantine } from '../dist/search/quarantine.js';
import { topologyNames } from '../dist/messaging/topology.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contentId = process.argv.find(value => value.startsWith('--content-id='))?.slice('--content-id='.length);

if (!contentId || !UUID_PATTERN.test(contentId)) {
  process.stderr.write('Usage: node scripts/e2e-seed-quarantine.mjs --content-id=<uuid>\n');
  process.exitCode = 2;
} else {
  const envPath = resolve(process.env.ENV_FILE ?? new URL('../.env.e2e', import.meta.url).pathname);
  const fileEnv = parseEnv(readFileSync(envPath, 'utf8'));
  const databaseUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  const natsUrl = process.env.NATS_URL ?? fileEnv.NATS_URL;
  if (!databaseUrl || !natsUrl) throw new Error('The E2E backend environment must define DATABASE_URL and NATS_URL.');

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2000 });
  let connection;
  try {
    const original = await waitForPublishedEvent(pool, contentId, 30_000);
    const names = topologyNames(
      process.env.NATS_STREAM ?? fileEnv.NATS_STREAM,
      process.env.NATS_SUBJECT ?? fileEnv.NATS_SUBJECT,
    );
    connection = await connect({ servers: natsUrl, name: 'indaplay-poc-e2e-quarantine-fixture', timeout: 2000 });
    const js = jetstream(connection, {
      timeout: Number(process.env.NATS_PUBLISH_ACK_TIMEOUT_MS ?? fileEnv.NATS_PUBLISH_ACK_TIMEOUT_MS ?? 5000),
    });
    const record = buildQuarantine({
      errorCode: 'projection_rejected',
      originalEventId: original.eventId,
      originalStream: names.stream,
      originalStreamSequence: original.streamSequence,
      originalSubject: names.subject,
      durable: names.durables[0],
    });
    const ack = await js.publish(names.quarantineSubject, new TextEncoder().encode(JSON.stringify(record)), {
      msgID: `e2e.quarantine.${randomUUID()}`,
    });
    process.stdout.write(`${JSON.stringify({
      sequence: ack.seq,
      quarantineId: record.quarantineId,
      originalEventId: record.originalEventId,
      originalSequence: record.originalStreamSequence,
    })}\n`);
  } finally {
    await pool.end().catch(() => undefined);
    await connection?.drain().catch(() => undefined);
  }
}

function parseEnv(raw) {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals <= 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function waitForPublishedEvent(pool, aggregateId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `select event_id::text as "eventId", stream_sequence::text as "streamSequence"
         from outbox_event
        where aggregate_id = $1 and stream_sequence is not null
        order by aggregate_version desc
        limit 1`,
      [aggregateId],
    );
    const row = result.rows[0];
    if (row) return { eventId: row.eventId, streamSequence: Number(row.streamSequence) };
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
  }
  throw new Error('The published content event did not receive a JetStream sequence before the fixture timeout.');
}
