import { z } from 'zod';
import { getScenario } from './registry';
import { markIdentityMismatch } from './engine';
import type { SafeRunContext } from './types';

const STORAGE_KEY = 'indaplay.phase6.scenario-run';

const assertionSchema = z.object({ label: z.string(), passed: z.boolean() }).strict();
const stepSchema = z.object({
  stepId: z.string(), title: z.string(),
  state: z.enum(['pending', 'running', 'passed', 'failed', 'manual', 'inconclusive']),
  startedAt: z.string().nullable(), completedAt: z.string().nullable(), durationMs: z.number().nullable(),
  httpStatus: z.number().int().optional(), problemCode: z.string().optional(), correlationId: z.string().optional(),
  contentVersion: z.number().int().optional(), contentStatus: z.enum(['draft', 'published', 'withdrawn']).optional(),
  assertions: z.array(assertionSchema), note: z.string().optional(),
}).strict();

const runSchema = z.object({
  schemaVersion: z.literal(1), scenarioId: z.enum(['S01', 'S02', 'S03', 'S04', 'S05']), scenarioVersion: z.literal(1),
  runId: z.string().uuid(), subjectHash: z.string().regex(/^[a-f0-9]{64}$/),
  roles: z.array(z.enum(['viewer', 'editor', 'publisher'])),
  permissions: z.array(z.enum(['content:read', 'content:write', 'content:publish', 'ops:read', 'ops:write'])),
  status: z.enum(['running', 'waiting_manual', 'passed', 'failed', 'cancelled', 'inconclusive']),
  currentStepIndex: z.number().int().nonnegative(), contentId: z.string().uuid().nullable(),
  contentVersion: z.number().int().positive().nullable(), contentStatus: z.enum(['draft', 'published', 'withdrawn']).nullable(),
  contentTitle: z.string().nullable(), startedAt: z.string(), completedAt: z.string().nullable(),
  preflight: z.array(assertionSchema), steps: z.array(stepSchema),
}).strict();

export async function fingerprintSubject(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function persistRun(run: SafeRunContext): void {
  const safe = runSchema.parse(run);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

export function clearPersistedRun(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function loadPersistedRun(subjectHash: string): SafeRunContext | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const run = runSchema.parse(JSON.parse(raw)) as SafeRunContext;
    const definition = getScenario(run.scenarioId);
    if (!definition || definition.version !== run.scenarioVersion || definition.steps.length !== run.steps.length) {
      clearPersistedRun();
      return null;
    }
    if (run.subjectHash !== subjectHash) return markIdentityMismatch(run);
    if (run.status === 'running') {
      return {
        ...run,
        status: 'inconclusive',
        completedAt: new Date().toISOString(),
        steps: run.steps.map((step) => step.state === 'running'
          ? { ...step, state: 'inconclusive', note: 'Az oldal újratöltődött futó kérés közben; az eredmény nem következtethető ki.' }
          : step),
      };
    }
    return run;
  } catch {
    clearPersistedRun();
    return null;
  }
}

export const persistenceKeyForTest = STORAGE_KEY;
