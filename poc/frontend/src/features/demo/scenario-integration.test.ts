import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationObservation, SafeRunContext, ScenarioDefinition } from './types';
import type { MeResponse, ProblemDocument } from '../../api/types';

vi.mock('./operations', () => ({
  executeOperation: vi.fn(async (
    operation: string,
    context: SafeRunContext,
    _signal: AbortSignal,
    _timeoutMs: number,
    expected: ScenarioDefinition['steps'][number]['expected'],
  ): Promise<OperationObservation> => {
    const http = expected.find((item) => item.kind === 'http');
    const content = expected.find((item) => item.kind === 'content');
    const expectedProblem = expected.find((item) => item.kind === 'problem');
    const catalog = expected.find((item) => item.kind === 'catalog');
    const search = expected.find((item) => item.kind === 'search');
    const identity = expected.find((item) => item.kind === 'identity');
    const processing = expected.find((item) => item.kind === 'processing');
    const audit = expected.find((item) => item.kind === 'audit');
    const status = http?.status ?? expectedProblem?.status ?? 200;
    const observation: OperationObservation = { httpStatus: status, correlationId: `test-${operation}` };

    if (content) {
      observation.data = { status: content.status, version: content.version };
      observation.contextPatch = {
        contentId: context.contentId ?? '00000000-0000-4000-8000-000000000006',
        contentVersion: content.version, contentStatus: content.status,
        contentTitle: context.contentTitle ?? `Fixture ${context.runId}`,
      };
    }
    if (operation.includes('create') && !observation.contextPatch) {
      observation.contextPatch = {
        contentId: '00000000-0000-4000-8000-000000000006', contentVersion: 1,
        contentStatus: 'draft', contentTitle: `Fixture ${context.runId}`,
      };
    }
    if (expectedProblem) {
      observation.problem = {
        type: 'urn:test', title: 'Expected', status: expectedProblem.status,
        code: expectedProblem.code as ProblemDocument['code'], detail: 'Expected test problem',
        instance: '/test', correlationId: observation.correlationId,
        fields: expectedProblem.fields,
        expectedVersion: expectedProblem.versionRelation ? 1 : undefined,
        actualVersion: expectedProblem.versionRelation ? 2 : undefined,
      };
    }
    if (catalog) observation.data = { catalogPresent: catalog.present };
    if (search) observation.data = { searchContainsContent: search.containsContent };
    if (identity) observation.data = { roles: identity.roles, permissions: identity.permissions ?? [] };
    if (processing) observation.data = { routeEligible: processing.routeEligible, reachable: processing.reachable };
    if (audit) observation.data = { audit: audit.sequence.map((item) => ({ action: item.action, version: item.version })) };
    return observation;
  }),
  observationProblemCode: (observation: OperationObservation) => observation.problem?.code,
}));

import { advanceRun, createRun } from './engine';
import { SCENARIOS } from './registry';

const me: MeResponse = {
  sub: 'integration-user', roles: ['publisher'],
  permissions: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
  expiresAt: '2030-01-01T00:00:00.000Z',
};

async function finish(definition: ScenarioDefinition): Promise<SafeRunContext> {
  let run = createRun(definition, 'a'.repeat(64), me);
  const signal = new AbortController().signal;
  run = await advanceRun(definition, run, signal, () => undefined);
  let checkpoints = 0;
  while (run.status === 'waiting_manual' && checkpoints < 10) {
    run = await advanceRun(definition, run, signal, () => undefined, true);
    checkpoints += 1;
  }
  return run;
}

describe('Phase 6 S01–S04 integration', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const id of ['S01', 'S02', 'S03', 'S04'] as const) {
    it(`${id} registry + engine + assertion + checkpoint flow reaches PASS`, async () => {
      const definition = SCENARIOS.find((scenario) => scenario.id === id)!;
      const run = await finish(definition);
      expect(run.status).toBe('passed');
      expect(run.steps.every((step) => step.state === 'passed')).toBe(true);
      expect(run.steps.flatMap((step) => step.assertions).every((assertion) => assertion.passed)).toBe(true);
    });
  }
});
