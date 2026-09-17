import type { SafeRunContext, ScenarioDefinition } from './types';

type Evidence = ReturnType<typeof buildEvidence>;

export function buildEvidence(definition: ScenarioDefinition, run: SafeRunContext) {
  return {
    schemaVersion: 1,
    scenario: { id: definition.id, version: definition.version, title: definition.title },
    run: {
      runId: run.runId,
      status: run.status,
      roles: [...run.roles],
      permissions: [...run.permissions],
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      content: run.contentId ? {
        id: run.contentId,
        version: run.contentVersion,
        status: run.contentStatus,
        title: run.contentTitle,
      } : null,
      preflight: run.preflight.map((item) => ({ label: item.label, passed: item.passed })),
      steps: run.steps.map((step) => ({
        stepId: step.stepId,
        title: step.title,
        state: step.state,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs: step.durationMs,
        httpStatus: step.httpStatus,
        problemCode: step.problemCode,
        correlationId: step.correlationId,
        contentVersion: step.contentVersion,
        contentStatus: step.contentStatus,
        assertions: step.assertions.map((item) => ({ label: item.label, passed: item.passed })),
        note: step.note,
      })),
    },
  };
}

const FORBIDDEN_KEYS = new Set([
  'token', 'accessToken', 'refreshToken', 'idToken', 'authorization', 'headers', 'requestBody',
  'responseBody', 'actorSub', 'sub', 'subjectHash', 'password', 'secret', 'cookie',
]);

export function assertEvidenceSafe(value: unknown): void {
  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== 'object') {
      if (typeof current === 'string' && /bearer\s+[a-z0-9._~-]+/i.test(current)) {
        throw new Error('Az evidence Bearer értéket tartalmaz.');
      }
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Tiltott evidence mező: ${key}`);
      visit(child);
    }
  }
  visit(value);
}

export function evidenceJson(definition: ScenarioDefinition, run: SafeRunContext): string {
  const evidence = buildEvidence(definition, run);
  assertEvidenceSafe(evidence);
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

function cell(value: unknown): string {
  return value === undefined || value === null || value === '' ? '—' : String(value).replaceAll('|', '\\|');
}

export function evidenceMarkdown(definition: ScenarioDefinition, run: SafeRunContext): string {
  const evidence: Evidence = buildEvidence(definition, run);
  assertEvidenceSafe(evidence);
  const lines = [
    `# ${evidence.scenario.id} – ${evidence.scenario.title}`,
    '',
    `- Run ID: \`${evidence.run.runId}\``,
    `- Állapot: **${evidence.run.status}**`,
    `- Indult: ${evidence.run.startedAt}`,
    `- Befejeződött: ${cell(evidence.run.completedAt)}`,
    `- Szerepkörök: ${evidence.run.roles.join(', ') || '—'}`,
    `- Jogosultságok: ${evidence.run.permissions.join(', ') || '—'}`,
    '',
    '## Preflight',
    '',
    ...evidence.run.preflight.map((item) => `- ${item.passed ? 'PASS' : 'FAIL'} – ${item.label}`),
    '',
    '## Lépések',
    '',
    '| Lépés | Állapot | HTTP | Problem | Verzió | Idő (ms) | Korreláció |',
    '|---|---|---:|---|---:|---:|---|',
    ...evidence.run.steps.map((step) =>
      `| ${cell(step.title)} | ${step.state} | ${cell(step.httpStatus)} | ${cell(step.problemCode)} | ${cell(step.contentVersion)} | ${cell(step.durationMs)} | ${cell(step.correlationId)} |`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function downloadEvidence(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
