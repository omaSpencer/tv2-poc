import { apiRequest } from './client';
import type {
  OperatorActionView,
  QuarantineItemView,
  QuarantineListView,
  ReindexPreflightView,
  ReindexRunView,
  ReplayQuarantineBody,
  StartContentRepairBody,
  StartReindexBody,
} from './types';

export function fetchReindexPreflight(index: 'a' | 'b', allowSearchOutage: boolean) {
  const query = new URLSearchParams({ index, allowSearchOutage: String(allowSearchOutage) });
  return apiRequest<ReindexPreflightView>(`/admin/search/reindex-preflight?${query}`);
}

export function startReindex(body: StartReindexBody, idempotencyKey: string) {
  return apiRequest<OperatorActionView>('/admin/search/reindex-runs', {
    method: 'POST', body, idempotencyKey, retryAuth: false,
  });
}

export function fetchReindexRun(runId: string) {
  return apiRequest<ReindexRunView>(`/admin/search/reindex-runs/${encodeURIComponent(runId)}`);
}

export function fetchOperatorAction(id: string) {
  return apiRequest<OperatorActionView>(`/admin/operator-actions/${encodeURIComponent(id)}`);
}

export function fetchQuarantineList(cursor?: string | null) {
  const query = new URLSearchParams({ limit: '50' });
  if (cursor) query.set('cursor', cursor);
  return apiRequest<QuarantineListView>(`/admin/search/quarantine?${query}`);
}

export function fetchQuarantineItem(sequence: number) {
  return apiRequest<QuarantineItemView>(`/admin/search/quarantine/${sequence}`);
}

export function replayQuarantine(sequence: number, body: ReplayQuarantineBody, idempotencyKey: string) {
  return apiRequest<OperatorActionView>(`/admin/search/quarantine/${sequence}/replays`, {
    method: 'POST', body, idempotencyKey, retryAuth: false,
  });
}

export function startContentRepair(body: StartContentRepairBody, idempotencyKey: string) {
  return apiRequest<OperatorActionView>('/admin/search/repairs', {
    method: 'POST', body, idempotencyKey, retryAuth: false,
  });
}
