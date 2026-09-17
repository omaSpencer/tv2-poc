/**
 * Integration support. The target database is chosen explicitly: without a
 * TEST_DATABASE_URL carrying a `_test` marker the suite stops instead of
 * touching a demo or development database.
 */
import pg from 'pg';
import type { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/database.js';
import { ContentRepository } from '../../src/content/content.repository.js';
import { OutboxRepository } from '../../src/outbox/outbox.repository.js';
import { OutboxWake } from '../../src/outbox/outbox.wake.js';
import { ContentService } from '../../src/content/content.service.js';
import type { Actor, OperationContext } from '../../src/identity/actor.js';

const TEST_DATABASE_PATTERN = /_test(_[a-z0-9-]+)?$/;

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required; integration tests never guess a target database.');
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!TEST_DATABASE_PATTERN.test(name)) {
    throw new Error('TEST_DATABASE_URL must name a disposable database ending with a _test marker.');
  }
  return url;
}

export function fakeConfig(url: string): ConfigService {
  return { getOrThrow: (key: string) => (key === 'DATABASE_URL' ? url : '') } as unknown as ConfigService;
}

export type Services = {
  database: DatabaseService;
  repository: ContentRepository;
  outbox: OutboxRepository;
  service: ContentService;
};

export function createServices(
  url = testDatabaseUrl(),
  repository: ContentRepository = new ContentRepository(),
  outbox: OutboxRepository = new OutboxRepository(),
  wake: OutboxWake = new OutboxWake(),
): Services {
  const database = new DatabaseService(fakeConfig(url));
  return { database, repository, outbox, service: new ContentService(database, repository, outbox, wake) };
}

export async function truncateAll(url = testDatabaseUrl()): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('TRUNCATE operator_action, outbox_event, content_audit, content');
    // Reindex control is durable by design, so TRUNCATE must not remove its
    // fixed A/B rows. Reset every operational field instead: an aborted test
    // must not leave a worker paused for the next integration file.
    await client.query(`
      update search_index_control set
        phase = 'ready', desired_worker_state = 'running', run_id = null,
        owner_id = null, owner_heartbeat_at = null,
        worker_heartbeat_at = null, worker_paused_at = null,
        worker_in_flight_event_id = null,
        snapshot_stream_sequence = null, outbox_high_water = null,
        catch_up_stream_sequence = null, imported_documents = 0,
        expected_documents = null, last_error_code = null, started_at = null,
        completed_at = statement_timestamp(), updated_at = statement_timestamp()
    `);
  } finally {
    await client.end();
  }
}

export async function query<T = any>(sql: string, params: unknown[] = [], url = testDatabaseUrl()): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

export const actor = (sub: string, roles: string[] = ['editor']): Actor => ({ sub, roles });

export const context = (sub: string, correlationId: string, roles: string[] = ['publisher']): OperationContext => ({
  actor: actor(sub, roles),
  correlationId,
});

/**
 * Explicit overlap for the concurrency cases: a gate connection takes a
 * conflicting lock, the contenders are started and observed as waiting, then
 * the gate commits and both continue against each other.
 */
export async function withLockGate<T>(
  lockSql: string,
  params: unknown[],
  waitingWriters: number,
  work: () => Promise<T>,
  url = testDatabaseUrl(),
): Promise<T> {
  const gate = new pg.Client({ connectionString: url });
  await gate.connect();
  await gate.query('BEGIN');
  await gate.query(lockSql, params);
  let pending: Promise<T>;
  try {
    pending = work();
    await waitForBlocked(waitingWriters, url);
  } finally {
    await gate.query('COMMIT');
    await gate.end();
  }
  return pending;
}

export async function waitForBlocked(count: number, url = testDatabaseUrl(), timeoutMs = 15_000): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const result = await client.query(
        "select count(*)::int as blocked from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      );
      if (Number(result.rows[0].blocked) >= count) return;
      if (Date.now() > deadline) throw new Error(`Only ${result.rows[0].blocked} of ${count} writers reached the lock.`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally {
    await client.end();
  }
}

export function settledStatus(results: PromiseSettledResult<unknown>[]): { ok: number; codes: string[] } {
  const codes: string[] = [];
  let ok = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') ok += 1;
    else codes.push((result.reason as { code?: string }).code ?? String(result.reason));
  }
  return { ok, codes: codes.sort() };
}
