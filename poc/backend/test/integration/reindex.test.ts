import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createServices, query, testDatabaseUrl, truncateAll } from '../support/database.js';
import { ReindexControlRepository } from '../../src/search/reindex/control.repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('M5 reindex persistence', () => {
  const services = databaseUrl ? createServices(testDatabaseUrl()) : null;
  const control = services ? new ReindexControlRepository(services.database) : null;

  const resetControl = () => query(`
      update search_index_control set
        phase = 'ready', desired_worker_state = 'running', run_id = null,
        owner_id = null, worker_paused_at = null, last_error_code = null,
        completed_at = statement_timestamp(), updated_at = statement_timestamp()
    `);
  beforeEach(async () => {
    await truncateAll();
    await resetControl();
  });
  afterAll(async () => {
    try { await resetControl(); }
    finally { await services?.database.onApplicationShutdown(); }
  });

  it('allows a server-side timeout override beyond the former 5.5-second client limit', async () => {
    await services!.database.withClient(async client => {
      await client.query('begin');
      try {
        await client.query("set local statement_timeout = '8000ms'");
        await client.query('select pg_sleep(6)');
      } finally {
        await client.query('rollback');
      }
    });
  });

  it('M5-T01 seeds exactly the durable A/B control rows', async () => {
    const rows = await control!.all();
    expect(rows.map(row => row.indexAlias).sort()).toEqual(['a', 'b']);
    expect(rows.every(row => row.phase === 'ready' && row.desiredWorkerState === 'running')).toBe(true);
    const columns = await query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'outbox_event' and column_name in ('outbox_sequence', 'stream_sequence')
      order by column_name
    `);
    expect(columns.map(row => row.column_name)).toEqual(['outbox_sequence', 'stream_sequence']);
  });

  it('M5-T02 admits only one global/index advisory-lock holder', async () => {
    await services!.database.withClient(async first => {
      expect(await control!.tryAcquireLocks(first, 'a')).toBe(true);
      await services!.database.withClient(async second => {
        expect(await control!.tryAcquireLocks(second, 'b')).toBe(false);
      });
      await control!.releaseLocks(first, 'a');
    });
  });

  it('persists a failed phase and never turns it ready implicitly', async () => {
    await control!.beginRun('a', '123e4567-e89b-42d3-a456-426614174000', 'test-owner');
    await control!.fail('a', 'stream_history_gap');
    const row = await control!.get('a');
    expect(row).toMatchObject({
      phase: 'failed', desiredWorkerState: 'paused', ownerId: null, lastErrorCode: 'stream_history_gap',
    });
  });
});
