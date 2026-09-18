import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { apiBaseLabel, backendDocsUrl } from '../api/client';
import { fetchLive, fetchReady } from '../api/health';
import { useAuth } from '../auth/authContext';
import { createFailureTracker, healthPollInterval } from '../lib/healthPollInterval';
import { useVisibleRefetch } from '../lib/useVisibleRefetch';

function pillClass(ok: boolean | null): string {
  if (ok === null) return 'pill pill-unknown';
  return ok ? 'pill pill-ok' : 'pill pill-bad';
}

function useTrackedHealthQuery(queryKey: readonly ['health', 'live' | 'ready'], queryFn: () => ReturnType<typeof fetchLive>) {
  const [tracker] = useState(createFailureTracker);
  const [trackedQueryFn] = useState(() => tracker.wrap(
    queryFn,
    response => response.status !== 200 || response.data.status !== 'ok',
  ));
  const refetchInterval = useCallback(
    () => healthPollInterval({
      consecutiveFailures: tracker.consecutiveFailures,
      visibilityState: document.visibilityState,
    }),
    [tracker],
  );
  const query = useQuery({
    queryKey,
    queryFn: trackedQueryFn,
    retry: false,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
  useVisibleRefetch(query.refetch, query.isFetching);
  return query;
}

export function StatusBar() {
  const { state, me } = useAuth();
  const live = useTrackedHealthQuery(['health', 'live'], fetchLive);
  const ready = useTrackedHealthQuery(['health', 'ready'], fetchReady);
  const liveOk = live.isSuccess ? live.data.status === 200 && live.data.data.status === 'ok' : null;
  const readyOk = ready.isSuccess ? ready.data.status === 200 && ready.data.data.status === 'ok' : null;
  const identityOk = state.kind === 'authenticated'
    ? true
    : state.kind === 'identity_unavailable' || state.kind === 'expired'
      ? false
      : null;
  const labels = {
    bootstrapping: '…', unconfigured: 'nincs beállítva', anonymous: 'nincs belépve',
    authenticating: 'átirányítás', loading_me: 'betöltés', authenticated: 'bejelentkezve',
    renewing: 'megújítás', expired: 'lejárt', identity_unavailable: 'nem elérhető',
  } as const;
  const identityLabel = me?.roles.join('+') || labels[state.kind];
  const readyCorrelationId = ready.data?.correlationId || '—';

  return (
    <header className="status-bar">
      <div className="brand-block">
        <p className="eyebrow">IndaPlay / TV2 PoC</p>
        <h1><Link to="/" className="brand-link">API kipróbálófelület</Link></h1>
      </div>
      <dl className="status-grid">
        <div><dt>API base</dt><dd className="mono">{apiBaseLabel()}</dd></div>
        <div><dt>live</dt><dd><span className={pillClass(liveOk)}>{liveOk === null ? '…' : liveOk ? 'ok' : 'leállt'}</span></dd></div>
        <div><dt>ready</dt><dd><span className={pillClass(readyOk)}>{readyOk === null ? '…' : readyOk ? 'ok' : 'nem kész'}</span></dd></div>
        <div><dt>identity</dt><dd><span className={pillClass(identityOk)}>{identityLabel}</span></dd></div>
        <div><dt>ready correlationId</dt><dd className="mono truncate">{readyCorrelationId}</dd></div>
        <div><dt>OpenAPI</dt><dd><a href={backendDocsUrl('/docs')} target="_blank" rel="noreferrer">/docs</a></dd></div>
      </dl>
    </header>
  );
}
