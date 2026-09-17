import {
  createContent, getAdminContent, listContentAudit, patchContent, publishContent, withdrawContent,
} from '../../api/admin';
import { fetchPublishedContent } from '../../api/catalog';
import { apiRequest, type ApiSuccess } from '../../api/client';
import { fetchReady } from '../../api/health';
import { fetchMe } from '../../api/me';
import { fetchProcessingStatus } from '../../api/processing';
import { searchCatalog } from '../../api/search';
import { isApiProblemError, type AdminContentView, type ProblemDocument } from '../../api/types';
import type {
  AllowedOperation, ExpectedResult, OperationObservation, SafeRunContext,
} from './types';

const POLL_INTERVAL_MS = 400;

function completeBody(title: string) {
  return {
    title,
    summary: 'Phase 6 scenario runner által létrehozott tartalom.',
    category: 'film' as const,
    mediaAssetId: 'vod-phase-6-fixture',
    tags: ['phase-6', 'scenario-runner'],
  };
}

function requireContent(context: SafeRunContext): { id: string; version: number; title: string } {
  if (!context.contentId || context.contentVersion === null || !context.contentTitle) {
    throw new Error('A lépéshez nincs biztonságosan eltárolt content referencia.');
  }
  return { id: context.contentId, version: context.contentVersion, title: context.contentTitle };
}

function success<T>(response: ApiSuccess<T>, contextPatch?: OperationObservation['contextPatch']): OperationObservation {
  return { httpStatus: response.status, correlationId: response.correlationId, data: response.data, contextPatch };
}

function problem(error: unknown): OperationObservation {
  if (!isApiProblemError(error)) throw error;
  return {
    httpStatus: error.problem.status,
    correlationId: error.correlationId,
    problem: error.problem,
  };
}

async function observed<T>(call: () => Promise<ApiSuccess<T>>): Promise<OperationObservation> {
  try {
    return success(await call());
  } catch (error) {
    return problem(error);
  }
}

function contentObservation(response: ApiSuccess<AdminContentView>): OperationObservation {
  const row = response.data;
  return success(response, {
    contentId: row.id,
    contentVersion: row.version,
    contentStatus: row.status,
    contentTitle: row.title,
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('A futás megszakítva.', 'AbortError'));
    }, { once: true });
  });
}

async function poll(
  timeoutMs: number,
  signal: AbortSignal,
  probe: () => Promise<{ done: boolean; observation: OperationObservation }>,
): Promise<OperationObservation> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted) {
    const current = await probe();
    if (current.done) return current.observation;
    if (Date.now() >= deadline) return current.observation;
    await delay(POLL_INTERVAL_MS, signal);
  }
  throw new DOMException('A futás megszakítva.', 'AbortError');
}

function expectedProcessing(expected: readonly ExpectedResult[]): { routeEligible: number; reachable: number } | null {
  const match = expected.find((item): item is Extract<ExpectedResult, { kind: 'processing' }> => item.kind === 'processing');
  return match ?? null;
}

export async function executeOperation(
  operation: AllowedOperation,
  context: SafeRunContext,
  signal: AbortSignal,
  timeoutMs: number,
  expected: readonly ExpectedResult[],
): Promise<OperationObservation> {
  if (signal.aborted) throw new DOMException('A futás megszakítva.', 'AbortError');

  if (operation === 'health.ready') return observed(fetchReady);
  if (operation === 'auth.me') return observed(fetchMe);

  if (operation === 'content.create-complete') {
    const title = `Phase 6 ${context.runId}`;
    return contentObservation(await createContent(completeBody(title)));
  }
  if (operation === 'content.edit') {
    const current = requireContent(context);
    return contentObservation(await patchContent(current.id, {
      expectedVersion: current.version,
      summary: 'Phase 6 scenario runner – ellenőrzött szerkesztés.',
      tags: ['phase-6', 'scenario-runner', 'edited'],
    }));
  }
  if (operation === 'content.publish') {
    const current = requireContent(context);
    return contentObservation(await publishContent(current.id, { expectedVersion: current.version }));
  }
  if (operation === 'content.admin-read') {
    const current = requireContent(context);
    return contentObservation(await getAdminContent(current.id));
  }
  if (operation === 'content.withdraw') {
    const current = requireContent(context);
    return contentObservation(await withdrawContent(current.id, { expectedVersion: current.version }));
  }
  if (operation === 'content.edit-withdrawn') {
    const current = requireContent(context);
    const title = `${current.title} – bővített`;
    return contentObservation(await patchContent(current.id, {
      expectedVersion: current.version,
      title,
    }));
  }
  if (operation === 'content.catalog-present' || operation === 'content.catalog-absent') {
    const current = requireContent(context);
    const shouldBePresent = operation === 'content.catalog-present';
    return poll(timeoutMs, signal, async () => {
      try {
        const response = await fetchPublishedContent(current.id);
        const observation = success(response);
        observation.data = { catalogPresent: true };
        return { done: shouldBePresent, observation };
      } catch (error) {
        const observation = problem(error);
        observation.data = { catalogPresent: false };
        const isExpectedAbsence = !shouldBePresent
          && observation.problem?.status === 404
          && observation.problem.code === 'content_not_found';
        return { done: isExpectedAbsence || observation.problem?.status !== 404, observation };
      }
    });
  }
  if (operation === 'content.search-present' || operation === 'content.search-absent') {
    const current = requireContent(context);
    const shouldContain = operation === 'content.search-present';
    return poll(timeoutMs, signal, async () => {
      try {
        const response = await searchCatalog(current.title, { limit: 20, offset: 0 });
        const contains = response.data.items.some((item) => item.id === current.id);
        const observation = success(response);
        observation.data = { searchContainsContent: contains };
        return { done: contains === shouldContain, observation };
      } catch (error) {
        return { done: true, observation: problem(error) };
      }
    });
  }
  if (operation === 'content.audit') {
    const current = requireContent(context);
    const response = await listContentAudit(current.id, { limit: 20 });
    return {
      httpStatus: response.status,
      correlationId: response.correlationId,
      data: {
        audit: response.data.items.map((item) => ({ action: item.action, version: item.contentVersion })),
      },
    };
  }

  if (operation === 'negative.create-incomplete') {
    const title = `Phase 6 hiányos ${context.runId}`;
    const response = await createContent({ title, summary: 'Hiányos publish fixture.', category: 'film' });
    return contentObservation(response);
  }
  if (operation === 'negative.publish-incomplete') {
    const current = requireContent(context);
    return observed(() => publishContent(current.id, { expectedVersion: current.version }));
  }
  if (operation === 'negative.create-published') {
    const title = `Phase 6 published ${context.runId}`;
    const created = await createContent(completeBody(title));
    return contentObservation(await publishContent(created.data.id, { expectedVersion: created.data.version }));
  }
  if (operation === 'negative.patch-published') {
    const current = requireContent(context);
    return observed(() => patchContent(current.id, { expectedVersion: current.version, summary: 'Tiltott patch.' }));
  }
  if (operation === 'negative.create-advanced') {
    const title = `Phase 6 stale ${context.runId}`;
    const created = await createContent(completeBody(title));
    return contentObservation(await patchContent(created.data.id, {
      expectedVersion: created.data.version,
      summary: 'A verziót v2-re léptető módosítás.',
    }));
  }
  if (operation === 'negative.patch-stale') {
    const current = requireContent(context);
    return observed(() => patchContent(current.id, { expectedVersion: 1, summary: 'Elavult kliens.' }));
  }
  if (operation === 'negative.invalid-payload') {
    return observed(() => apiRequest<AdminContentView>('/admin/contents', {
      method: 'POST',
      body: { title: 'x'.repeat(201) },
    }));
  }
  if (operation === 'negative.oversized-payload') {
    return observed(() => apiRequest<AdminContentView>('/admin/contents', {
      method: 'POST',
      body: { title: 'x'.repeat(257 * 1024) },
    }));
  }

  if (operation === 'permission.admin-read') {
    return observed(() => apiRequest('/admin/contents?limit=1'));
  }
  if (operation === 'permission.missing-token') {
    return observed(() => apiRequest('/me', { auth: false, retryAuth: false }));
  }
  if (operation === 'permission.create' || operation === 'outage.cms-write') {
    const title = `${operation === 'permission.create' ? 'Jogosultság' : 'Outage CMS'} ${context.runId}`;
    try {
      return contentObservation(await createContent(completeBody(title)));
    } catch (error) {
      return problem(error);
    }
  }
  if (operation === 'permission.publish') {
    const current = requireContent(context);
    try {
      return contentObservation(await publishContent(current.id, { expectedVersion: current.version }));
    } catch (error) {
      return problem(error);
    }
  }

  if (operation === 'outage.search') {
    return observed(() => searchCatalog('phase-6', { limit: 20, offset: 0 }));
  }
  if (operation === 'outage.processing') {
    const wanted = expectedProcessing(expected);
    return poll(timeoutMs, signal, async () => {
      try {
        const response = await fetchProcessingStatus();
        const indexes = response.data.indexes ? Object.values(response.data.indexes) : [];
        const counts = {
          routeEligible: indexes.filter((index) => index.routeEligible).length,
          reachable: indexes.filter((index) => index.reachable === true).length,
        };
        const observation = success(response);
        observation.data = counts;
        return {
          done: !wanted || (counts.routeEligible === wanted.routeEligible && counts.reachable === wanted.reachable),
          observation,
        };
      } catch (error) {
        return { done: true, observation: problem(error) };
      }
    });
  }

  const exhaustive: never = operation;
  throw new Error(`Nem támogatott allowlisted művelet: ${String(exhaustive)}`);
}

export function observationProblemCode(observation: OperationObservation): ProblemDocument['code'] | undefined {
  return observation.problem?.code;
}
