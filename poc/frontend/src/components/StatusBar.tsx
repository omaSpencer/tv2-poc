import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { apiBaseLabel, backendDocsUrl, getLastCorrelationId } from '../api/client';
import { fetchLive, fetchReady } from '../api/health';
import { useAuth } from '../auth/authContext';

function pillClass(ok: boolean | null): string {
  if (ok === null) return 'pill pill-unknown';
  return ok ? 'pill pill-ok' : 'pill pill-bad';
}
export function StatusBar() {
  const { state, me } = useAuth();
  const live = useQuery({ queryKey: ['health', 'live'], queryFn: fetchLive, refetchInterval: 10_000 });
  const ready = useQuery({ queryKey: ['health', 'ready'], queryFn: fetchReady, refetchInterval: 10_000 });
  const liveOk = live.isSuccess ? live.data.status === 200 && live.data.data.status === 'ok' : null;
  const readyOk = ready.isSuccess ? ready.data.status === 200 && ready.data.data.status === 'ok' : null;
  const identityOk = state.kind === 'authenticated'
    ? true
    : state.kind === 'identity_unavailable' || state.kind === 'expired'
      ? false
      : null;
  const labels = {
    bootstrapping: '…', unconfigured: 'not configured', anonymous: 'anonymous',
    authenticating: 'redirecting', loading_me: 'loading', authenticated: 'authenticated',
    renewing: 'renewing', expired: 'expired', identity_unavailable: 'unavailable',
  } as const;
  const identityLabel = me?.roles.join('+') || labels[state.kind];
  const correlationId = ready.data?.correlationId || live.data?.correlationId || getLastCorrelationId() || '—';

  return (
    <header className="status-bar">
      <div className="brand-block">
        <p className="eyebrow">IndaPlay / TV2 PoC</p>
        <h1><Link to="/" className="brand-link">API playground</Link></h1>
      </div>
      <dl className="status-grid">
        <div><dt>API base</dt><dd className="mono">{apiBaseLabel()}</dd></div>
        <div><dt>live</dt><dd><span className={pillClass(liveOk)}>{liveOk === null ? '…' : liveOk ? 'ok' : 'down'}</span></dd></div>
        <div><dt>ready</dt><dd><span className={pillClass(readyOk)}>{readyOk === null ? '…' : readyOk ? 'ok' : 'not ready'}</span></dd></div>
        <div><dt>identity</dt><dd><span className={pillClass(identityOk)}>{identityLabel}</span></dd></div>
        <div><dt>correlationId</dt><dd className="mono truncate">{correlationId}</dd></div>
        <div><dt>OpenAPI</dt><dd><a href={backendDocsUrl('/docs')} target="_blank" rel="noreferrer">/docs</a></dd></div>
      </dl>
    </header>
  );
}
