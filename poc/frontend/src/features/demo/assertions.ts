import type { ExpectedResult, OperationObservation, AssertionResult } from './types';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function sameStrings(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || !actual.every((item) => typeof item === 'string')) return false;
  return [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function result(label: string, passed: boolean): AssertionResult {
  return { label, passed };
}

export function evaluateAssertions(
  expectedResults: readonly ExpectedResult[],
  observation: OperationObservation,
): AssertionResult[] {
  return expectedResults.map((expected) => {
    const data = record(observation.data);

    if (expected.kind === 'http') {
      return result(`HTTP ${expected.status}`, observation.httpStatus === expected.status);
    }
    if (expected.kind === 'problem') {
      const problem = observation.problem;
      const fieldsMatch = expected.fields === undefined || sameStrings(problem?.fields, expected.fields);
      const versionsMatch = expected.versionRelation === undefined || (
        typeof problem?.expectedVersion === 'number'
        && typeof problem.actualVersion === 'number'
        && problem.expectedVersion < problem.actualVersion
      );
      return result(
        `problem ${expected.status} ${expected.code}${expected.fields ? ` fields=${expected.fields.join(',')}` : ''}`,
        Boolean(problem && problem.status === expected.status && problem.code === expected.code && fieldsMatch && versionsMatch),
      );
    }
    if (expected.kind === 'content') {
      return result(
        `${expected.status} v${expected.version}`,
        data?.status === expected.status && data.version === expected.version,
      );
    }
    if (expected.kind === 'catalog') {
      return result(
        expected.present ? 'katalógusban jelen' : 'katalógusból hiányzik',
        data?.catalogPresent === expected.present,
      );
    }
    if (expected.kind === 'search') {
      return result(
        expected.containsContent ? 'keresésben jelen' : 'keresésből hiányzik',
        data?.searchContainsContent === expected.containsContent,
      );
    }
    if (expected.kind === 'identity') {
      const rolesOk = sameStrings(data?.roles, expected.roles);
      const permissionsOk = expected.permissions === undefined
        || sameStrings(data?.permissions, expected.permissions);
      return result(`identitás: ${expected.roles.join('+')}`, rolesOk && permissionsOk);
    }
    if (expected.kind === 'processing') {
      return result(
        `${expected.routeEligible} forgalomképes / ${expected.reachable} elérhető index`,
        data?.routeEligible === expected.routeEligible && data.reachable === expected.reachable,
      );
    }
    const items = Array.isArray(data?.audit) ? data.audit : [];
    const actual = items.map((item) => {
      const row = record(item);
      return `${String(row?.action)}:${String(row?.version)}`;
    });
    const wanted = expected.sequence.map((item) => `${item.action}:${item.version}`);
    return result(`audit: ${wanted.join(' → ')}`, actual.join('|') === wanted.join('|'));
  });
}

export function assertionsPassed(results: readonly AssertionResult[]): boolean {
  return results.every((assertion) => assertion.passed);
}
