import type { Role } from '../contracts/permissions.js';
import type { OperatorActionRecord } from './operator-action.repository.js';

export type OperatorActionView = {
  id: string;
  kind: OperatorActionRecord['kind'];
  state: OperatorActionRecord['state'];
  requestedBy: string;
  requestedRoles: Role[];
  reason: string;
  target: Record<string, unknown>;
  result: OperatorActionRecord['result'];
  correlationId: string;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
};

export function toOperatorActionView(action: OperatorActionRecord): OperatorActionView {
  let target: Record<string, unknown>;
  if (action.kind === 'reindex' && 'index' in action.target) {
    target = { index: action.target.index, allowSearchOutage: action.target.allowSearchOutage };
  } else if (action.kind === 'quarantine_replay' && 'sequence' in action.target) {
    target = { sequence: action.target.sequence };
  } else if (action.kind === 'content_repair' && 'contentId' in action.target) {
    target = { contentId: action.target.contentId, target: action.target.target };
  } else {
    target = {};
  }
  return {
    id: action.id,
    kind: action.kind,
    state: action.state,
    requestedBy: action.requestedBy,
    requestedRoles: action.requestedRoles as Role[],
    reason: action.reason,
    target,
    result: action.result,
    correlationId: action.correlationId,
    errorCode: action.errorCode,
    createdAt: action.createdAt.toISOString(),
    startedAt: action.startedAt?.toISOString() ?? null,
    heartbeatAt: action.heartbeatAt?.toISOString() ?? null,
    completedAt: action.completedAt?.toISOString() ?? null,
  };
}
