import { describe, expect, it } from 'vitest';
import { advanceRun, createRun } from './engine';
import type { ScenarioDefinition } from './types';
import type { MeResponse } from '../../api/types';

const definition: ScenarioDefinition = {
  id: 'S05', version: 1, title: 'Manual', description: 'Manual test',
  requiredPermissions: [], preflight: { authenticated: true, backendReady: false, searchEnabled: false },
  steps: [{ id: 'manual', title: 'Checkpoint', detail: 'Do it', mode: 'manual', instruction: 'Do it', expected: [] }],
};

const me: MeResponse = { sub: 'u', roles: ['publisher'], permissions: [], expiresAt: '2030-01-01T00:00:00.000Z' };

describe('Phase 6 execution engine', () => {
  it('pauses at a manual checkpoint and only passes after explicit continuation', async () => {
    const run = createRun(definition, 'a'.repeat(64), me);
    const first = await advanceRun(definition, run, new AbortController().signal, () => undefined);
    expect(first.status).toBe('waiting_manual');
    expect(first.steps[0].state).toBe('manual');
    const completed = await advanceRun(definition, first, new AbortController().signal, () => undefined, true);
    expect(completed.status).toBe('passed');
    expect(completed.steps[0].state).toBe('passed');
  });
});
