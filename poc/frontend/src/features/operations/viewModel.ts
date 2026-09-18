import { isApiProblemError, type ProcessingStatus } from '../../api/types';

export type StatusTone = 'ok' | 'warning' | 'danger' | 'neutral';

export type SearchAvailability = {
  kind: 'full' | 'fallback' | 'unavailable' | 'unknown';
  tone: StatusTone;
  label: string;
  detail: string;
};

export function searchAvailability(status: ProcessingStatus): SearchAvailability {
  if (!status.indexes) {
    return {
      kind: 'unknown', tone: 'neutral', label: 'Keresési állapot nem elérhető',
      detail: 'Ez a konfiguráció nem jelent A/B indexállapotot.',
    };
  }

  const eligible = Number(status.indexes.a.routeEligible) + Number(status.indexes.b.routeEligible);
  if (eligible === 2) {
    return {
      kind: 'full', tone: 'ok', label: 'Teljes A/B rendelkezésre állás',
      detail: 'Mindkét keresőindex routolható.',
    };
  }
  if (eligible === 1) {
    return {
      kind: 'fallback', tone: 'warning', label: 'Tartalék üzem – csökkent redundancia',
      detail: 'Egy keresőindex routolható; a másik nem tud forgalmat fogadni.',
    };
  }
  return {
    kind: 'unavailable', tone: 'danger', label: 'A keresés nem routolható',
    detail: 'Egyik keresőindex sem routolható.',
  };
}

export function isProcessingActive(status: ProcessingStatus | undefined): boolean {
  if (!status) return false;
  if (status.relay.state === 'publishing' || status.relay.state === 'retrying') return true;
  if (!status.indexes) return false;
  const indexes = status.indexes;
  return (['a', 'b'] as const).some(alias => {
    const index = indexes[alias];
    return index.state === 'processing' || index.state === 'retrying'
      || (index.phase !== null && index.phase !== 'ready' && index.phase !== 'failed');
  });
}

export function isAuthorizationError(error: unknown): boolean {
  return isApiProblemError(error) && (error.problem.status === 401 || error.problem.status === 403);
}

export function processingPollInterval(input: {
  status?: ProcessingStatus;
  error: unknown;
  failureCount: number;
  visibilityState: DocumentVisibilityState;
}): number | false {
  if (input.visibilityState !== 'visible' || isAuthorizationError(input.error)) return false;
  if (input.error) {
    const exponent = Math.max(0, input.failureCount - 1);
    return Math.min(30_000, 2_000 * (2 ** exponent));
  }
  return isProcessingActive(input.status) ? 2_000 : 10_000;
}

export function relayTone(enabled: boolean, state: ProcessingStatus['relay']['state']): StatusTone {
  if (!enabled || state === 'off') return 'neutral';
  if (state === 'idle') return 'ok';
  if (state === 'publishing') return 'warning';
  return 'danger';
}

export function indexStateTone(state: NonNullable<ProcessingStatus['indexes']>['a']['state']): StatusTone {
  if (state === 'idle') return 'ok';
  if (state === 'off') return 'neutral';
  if (state === 'bootstrapping' || state === 'processing' || state === 'paused') return 'warning';
  return 'danger';
}

export const RELAY_LABELS: Record<ProcessingStatus['relay']['state'], string> = {
  off: 'Kikapcsolva',
  idle: 'Üresjárat',
  publishing: 'Publikálás folyamatban',
  retrying: 'Újrapróbálás',
  halted: 'Leállt',
};

export const INDEX_STATE_LABELS: Record<NonNullable<ProcessingStatus['indexes']>['a']['state'], string> = {
  off: 'Kikapcsolva',
  bootstrapping: 'Indítás',
  idle: 'Üresjárat',
  processing: 'Feldolgozás',
  retrying: 'Újrapróbálás',
  paused: 'Szüneteltetve',
  halted: 'Leállt',
};

export const PHASE_LABELS: Record<NonNullable<NonNullable<ProcessingStatus['indexes']>['a']['phase']>, string> = {
  ready: 'Kész',
  draining: 'Leürítés',
  importing: 'Importálás',
  swapping: 'Átváltás',
  catching_up: 'Felzárkózás',
  verifying: 'Ellenőrzés',
  failed: 'Sikertelen',
};

export const OPERATOR_ACTION_STATE_LABELS: Record<'queued' | 'running' | 'succeeded' | 'failed', string> = {
  queued: 'Sorban',
  running: 'Fut',
  succeeded: 'Sikeres',
  failed: 'Sikertelen',
};

export const OPERATOR_ACTION_KIND_LABELS: Record<'reindex' | 'quarantine_replay' | 'content_repair', string> = {
  reindex: 'Reindex',
  quarantine_replay: 'Karantén-visszajátszás',
  content_repair: 'Tartalomjavítás',
};
