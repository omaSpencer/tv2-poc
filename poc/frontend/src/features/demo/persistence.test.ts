import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import { loadPersistedRun, persistRun } from './persistence';
import { SCENARIOS } from './registry';
import type { MeResponse } from '../../api/types';

const me: MeResponse = {
  sub: 'user-a', roles: ['publisher'],
  permissions: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
  expiresAt: '2030-01-01T00:00:00.000Z',
};

describe('Phase 6 safe persistence', () => {
  it('never automatically resumes an in-flight mutation after reload', () => {
    const run = createRun(SCENARIOS[0], 'a'.repeat(64), me);
    run.steps[0].state = 'running';
    persistRun(run);
    const restored = loadPersistedRun('a'.repeat(64));
    expect(restored?.status).toBe('inconclusive');
    expect(restored?.steps[0].state).toBe('inconclusive');
  });

  it('requires an explicit manual confirmation when the subject changes at a checkpoint', () => {
    const run = createRun(SCENARIOS[0], 'a'.repeat(64), me);
    run.status = 'waiting_manual';
    persistRun(run);
    const restored = loadPersistedRun('b'.repeat(64));
    expect(restored?.status).toBe('waiting_manual');
    expect(restored?.steps[0].note).toMatch(/explicit kézi megerősítés/);
  });

  it('persists a UUID v7 content id and rejects nil ids', () => {
    const run = createRun(SCENARIOS[0], 'a'.repeat(64), me);
    run.contentId = '018f1e2c-8b7a-7d3e-9c4b-1a2b3c4d5e6f';
    persistRun(run);
    expect(loadPersistedRun('a'.repeat(64))?.contentId).toBe(run.contentId);
    run.contentId = '00000000-0000-0000-0000-000000000000';
    expect(() => persistRun(run)).toThrow();
  });
});
