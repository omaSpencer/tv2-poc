import { describe, expect, it, vi } from 'vitest';
import { isStagingIndexUid, phaseIsRoutable, stagingIndexUid } from '../src/contracts/reindex.js';
import { validateConfig, ConfigurationError } from '../src/config.js';
import { StagingImporter } from '../src/search/reindex/importer.js';
import type { MeiliIndexAdapter } from '../src/search/meili.adapter.js';
import type { ReindexControlRepository } from '../src/search/reindex/control.repository.js';

const baseConfig = () => ({
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://poc:secret@127.0.0.1:5432/poc_test',
  FEATURE_IDENTITY: 'off',
  FEATURE_OUTBOX_RELAY: 'off',
  FEATURE_SEARCH: 'off',
  FEATURE_MEDIA: 'off',
});

describe('M5 durable recovery contracts', () => {
  it('routes only the durable ready phase', () => {
    expect(phaseIsRoutable('ready')).toBe(true);
    for (const phase of ['draining', 'importing', 'swapping', 'catching_up', 'verifying', 'failed'] as const) {
      expect(phaseIsRoutable(phase)).toBe(false);
    }
  });

  it('derives a run-scoped staging UID and refuses lookalikes', () => {
    const runId = '123e4567-e89b-42d3-a456-426614174000';
    const uid = stagingIndexUid('contents', runId);
    expect(uid).toBe('contents__rebuild__123e4567e89b42d3a456426614174000');
    expect(isStagingIndexUid(uid, 'contents')).toBe(true);
    expect(isStagingIndexUid('contents__rebuild__not-a-run', 'contents')).toBe(false);
    expect(isStagingIndexUid(uid, 'other')).toBe(false);
  });

  it('validates the worker heartbeat and verify-barrier relationships', () => {
    expect(validateConfig(baseConfig()).REINDEX_BATCH_SIZE).toBe(500);
    expect(() => validateConfig({
      ...baseConfig(), REINDEX_OWNER_HEARTBEAT_MS: 5000, REINDEX_WORKER_STALE_MS: 5000,
    })).toThrow(ConfigurationError);
    expect(() => validateConfig({
      ...baseConfig(), REINDEX_VERIFY_TIMEOUT_MS: 4000, CONTENT_WRITE_BARRIER_WAIT_MS: 5000,
    })).toThrow(ConfigurationError);
  });

  it('counts a batch only after its Meilisearch task succeeds', async () => {
    const adapter = {
      indexUid: 'contents',
      submitBatch: vi.fn(async () => 17),
      awaitTask: vi.fn(async () => ({ uid: 17, status: 'succeeded', errorCode: null })),
    } as unknown as MeiliIndexAdapter;
    const control = { addImported: vi.fn(async () => undefined) } as unknown as ReindexControlRepository;
    const importer = new StagingImporter(adapter, control, 'a', '123e4567-e89b-42d3-a456-426614174000');
    await importer.import([{
      id: '123e4567-e89b-42d3-a456-426614174001',
      title: 'Cím', summary: 'Összefoglaló', category: 'film', tags: ['minta'], aggregateVersion: 2,
    }]);
    expect(control.addImported).toHaveBeenCalledWith('a', 1);
  });

  it('does not count a failed import task', async () => {
    const adapter = {
      indexUid: 'contents',
      submitBatch: vi.fn(async () => 18),
      awaitTask: vi.fn(async () => ({ uid: 18, status: 'failed', errorCode: 'invalid_document_fields' })),
    } as unknown as MeiliIndexAdapter;
    const control = { addImported: vi.fn(async () => undefined) } as unknown as ReindexControlRepository;
    const importer = new StagingImporter(adapter, control, 'b', '123e4567-e89b-42d3-a456-426614174000');
    await expect(importer.import([{
      id: '123e4567-e89b-42d3-a456-426614174001',
      title: 'Cím', summary: 'Összefoglaló', category: 'film', tags: [], aggregateVersion: 1,
    }])).rejects.toMatchObject({ code: 'import_task_failed' });
    expect(control.addImported).not.toHaveBeenCalled();
  });
});
