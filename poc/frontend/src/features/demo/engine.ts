import { fetchReady } from '../../api/health';
import { fetchProcessingStatus } from '../../api/processing';
import type { MeResponse } from '../../api/types';
import { assertionsPassed, evaluateAssertions } from './assertions';
import { executeOperation, observationProblemCode } from './operations';
import type {
  SafeRunContext, SafeStepResult, ScenarioDefinition,
} from './types';

export type RunListener = (run: SafeRunContext) => void;

function publish(run: SafeRunContext, listener: RunListener): void {
  listener({ ...run, preflight: [...run.preflight], steps: run.steps.map((step) => ({ ...step })) });
}

function now(): string {
  return new Date().toISOString();
}

function elapsed(startedAt: string): number {
  return Math.max(0, Date.now() - new Date(startedAt).getTime());
}

export function createRun(
  definition: ScenarioDefinition,
  subjectHash: string,
  me: MeResponse,
): SafeRunContext {
  return {
    schemaVersion: 1,
    scenarioId: definition.id,
    scenarioVersion: definition.version,
    runId: crypto.randomUUID(),
    subjectHash,
    roles: [...me.roles],
    permissions: [...me.permissions],
    status: 'running',
    currentStepIndex: 0,
    contentId: null,
    contentVersion: null,
    contentStatus: null,
    contentTitle: null,
    startedAt: now(),
    completedAt: null,
    preflight: [],
    steps: definition.steps.map((step) => ({
      stepId: step.id,
      title: step.title,
      state: 'pending',
      startedAt: null,
      completedAt: null,
      durationMs: null,
      assertions: [],
    })),
  };
}

export async function runPreflight(
  definition: ScenarioDefinition,
  run: SafeRunContext,
  me: MeResponse | null,
  listener: RunListener,
): Promise<boolean> {
  const checks = [];
  if (definition.preflight.authenticated) {
    checks.push({ label: 'bejelentkezett identitás', passed: me !== null });
  }
  for (const permission of definition.requiredPermissions) {
    checks.push({ label: `jogosultság: ${permission}`, passed: Boolean(me?.permissions.includes(permission)) });
  }
  if (definition.preflight.backendReady) {
    try {
      const response = await fetchReady();
      checks.push({ label: 'a backend készen áll', passed: response.status === 200 && response.data.status === 'ok' });
    } catch {
      checks.push({ label: 'a backend készen áll', passed: false });
    }
  }
  if (definition.preflight.searchEnabled) {
    try {
      const response = await fetchProcessingStatus();
      checks.push({ label: 'a keresési funkció aktív', passed: response.status === 200 && Boolean(response.data.indexes) });
    } catch {
      checks.push({ label: 'a keresési funkció aktív', passed: false });
    }
  }
  run.preflight = checks;
  if (!checks.every((check) => check.passed)) {
    run.status = 'failed';
    run.completedAt = now();
  }
  publish(run, listener);
  return checks.every((check) => check.passed);
}

function safeUnexpectedNote(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'A futást a felhasználó megszakította.';
  return 'Váratlan hálózati vagy klienshiba; a lépés nem tekinthető sikeresnek.';
}

export async function advanceRun(
  definition: ScenarioDefinition,
  run: SafeRunContext,
  signal: AbortSignal,
  listener: RunListener,
  manualAuthorized = false,
): Promise<SafeRunContext> {
  let mayRunManual = manualAuthorized;
  try {
    while (run.currentStepIndex < definition.steps.length) {
      const index = run.currentStepIndex;
      const definitionStep = definition.steps[index];
      const result = run.steps[index];

      if (definitionStep.mode === 'manual' && !mayRunManual) {
        result.state = 'manual';
        run.status = 'waiting_manual';
        publish(run, listener);
        return run;
      }
      mayRunManual = false;

      const startedAt = now();
      Object.assign(result, {
        state: 'running', startedAt, completedAt: null, durationMs: null, assertions: [], note: undefined,
      } satisfies Partial<SafeStepResult>);
      run.status = 'running';
      publish(run, listener);

      if (definitionStep.operation) {
        const observation = await executeOperation(
          definitionStep.operation,
          run,
          signal,
          definitionStep.timeoutMs ?? 15_000,
          definitionStep.expected,
        );
        if (observation.contextPatch) Object.assign(run, observation.contextPatch);
        const assertions = evaluateAssertions(definitionStep.expected, observation);
        const passed = assertionsPassed(assertions);
        Object.assign(result, {
          state: passed ? 'passed' : 'failed',
          completedAt: now(),
          durationMs: elapsed(startedAt),
          httpStatus: observation.httpStatus,
          problemCode: observationProblemCode(observation),
          correlationId: observation.correlationId || undefined,
          contentVersion: run.contentVersion ?? undefined,
          contentStatus: run.contentStatus ?? undefined,
          assertions,
          note: passed ? undefined : 'Az egzakt elvárások közül legalább egy nem teljesült.',
        } satisfies Partial<SafeStepResult>);
        if (!passed) {
          run.status = 'failed';
          run.completedAt = now();
          publish(run, listener);
          return run;
        }
      } else {
        Object.assign(result, {
          state: 'passed', completedAt: now(), durationMs: elapsed(startedAt), assertions: [],
          note: 'Kézzel megerősített üzemeltetési pont.',
        } satisfies Partial<SafeStepResult>);
      }

      run.currentStepIndex += 1;
      publish(run, listener);
    }

    run.status = 'passed';
    run.completedAt = now();
    publish(run, listener);
    return run;
  } catch (error) {
    const result = run.steps[run.currentStepIndex];
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    if (result) {
      result.state = cancelled ? 'inconclusive' : 'failed';
      result.completedAt = now();
      result.durationMs = result.startedAt ? elapsed(result.startedAt) : null;
      result.note = safeUnexpectedNote(error);
    }
    run.status = cancelled ? 'cancelled' : 'failed';
    run.completedAt = now();
    publish(run, listener);
    return run;
  }
}

export function markIdentityMismatch(run: SafeRunContext): SafeRunContext {
  if (run.status === 'waiting_manual') {
    return {
      ...run,
      steps: run.steps.map((step, index) => index === run.currentStepIndex
        ? { ...step, state: 'manual', note: 'Az identitás megváltozott; csak explicit kézi megerősítés után folytatható.' }
        : step),
    };
  }
  return {
    ...run,
    status: 'inconclusive',
    completedAt: now(),
    steps: run.steps.map((step, index) => index === run.currentStepIndex && step.state !== 'passed'
      ? { ...step, state: 'inconclusive', note: 'Az identitás megváltozott; automatikus folytatás letiltva.' }
      : step),
  };
}
