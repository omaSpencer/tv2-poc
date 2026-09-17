import { describe, expect, it } from 'vitest';
import { assertionsPassed, evaluateAssertions } from './assertions';

describe('Phase 6 exact assertions', () => {
  it('requires exact problem status, code and field set', () => {
    const expected = [{ kind: 'problem' as const, status: 422, code: 'validation_failed' as const, fields: ['mediaAssetId'] }];
    expect(assertionsPassed(evaluateAssertions(expected, {
      httpStatus: 422, correlationId: 'c',
      problem: { type: 'x', title: 'x', status: 422, code: 'validation_failed', detail: 'x', instance: 'x', correlationId: 'c', fields: ['mediaAssetId'] },
    }))).toBe(true);
    expect(assertionsPassed(evaluateAssertions(expected, {
      httpStatus: 422, correlationId: 'c',
      problem: { type: 'x', title: 'x', status: 422, code: 'validation_failed', detail: 'x', instance: 'x', correlationId: 'c', fields: ['mediaAssetId', 'title'] },
    }))).toBe(false);
  });

  it('does not turn a different error into a passing expected outage', () => {
    const results = evaluateAssertions(
      [{ kind: 'problem', status: 503, code: 'search_unavailable' }],
      {
        httpStatus: 401, correlationId: 'c',
        problem: { type: 'x', title: 'x', status: 401, code: 'unauthenticated', detail: 'x', instance: 'x', correlationId: 'c' },
      },
    );
    expect(assertionsPassed(results)).toBe(false);
  });

  it('requires both expected and actual versions for stale writes', () => {
    const expected = [{ kind: 'problem' as const, status: 409, code: 'version_conflict' as const, versionRelation: 'expected-less-than-actual' as const }];
    const base = { type: 'x', title: 'x', status: 409, code: 'version_conflict' as const, detail: 'x', instance: 'x', correlationId: 'c' };
    expect(assertionsPassed(evaluateAssertions(expected, { httpStatus: 409, correlationId: 'c', problem: base }))).toBe(false);
    expect(assertionsPassed(evaluateAssertions(expected, {
      httpStatus: 409, correlationId: 'c', problem: { ...base, expectedVersion: 1, actualVersion: 2 },
    }))).toBe(true);
  });
});
