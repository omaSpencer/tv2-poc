import { describe, expect, it } from 'vitest';
import { createRun } from './engine';
import { assertEvidenceSafe, buildEvidence, evidenceJson, evidenceMarkdown } from './export';
import { SCENARIOS } from './registry';
import type { MeResponse } from '../../api/types';

const me: MeResponse = {
  sub: 'sensitive-user-id', roles: ['publisher'],
  permissions: ['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'],
  expiresAt: '2030-01-01T00:00:00.000Z',
};

describe('Phase 6 evidence export', () => {
  it('exports only the explicit safe allowlist', () => {
    const run = createRun(SCENARIOS[0], 'a'.repeat(64), me);
    run.steps[0].correlationId = 'phase-6-correlation';
    const evidence = buildEvidence(SCENARIOS[0], run);
    const json = evidenceJson(SCENARIOS[0], run);
    const markdown = evidenceMarkdown(SCENARIOS[0], run);
    expect(() => assertEvidenceSafe(evidence)).not.toThrow();
    expect(json).not.toContain(me.sub);
    expect(json).not.toContain(run.subjectHash);
    expect(markdown).toContain(run.runId);
  });

  it('rejects secret-shaped keys and Bearer canaries', () => {
    expect(() => assertEvidenceSafe({ accessToken: 'canary' })).toThrow(/Tiltott/);
    expect(() => assertEvidenceSafe({ note: 'Bearer canary.token.value' })).toThrow(/Bearer/);
  });
});
