import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { apiBaseLabel, backendDocsUrl, getLastCorrelationId } from '../api/client';
import { fetchLive, fetchReady } from '../api/health';
import { fetchMe } from '../api/me';
import { useAuthSession } from '../auth/sessionContext';

function pillClass(ok: boolean | null): string {
  if (ok === null) return 'pill pill-unknown';
  return ok ? 'pill pill-ok' : 'pill pill-bad';
}

export function StatusBar() {
  const { accessToken } = useAuthSession();

  const live = useQuery({
    queryKey: ['health', 'live'],
    queryFn: fetchLive,
    refetchInterval: 10_000,
  });
  const ready = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: fetchReady,
    refetchInterval: 10_000,
  });
  const me = useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken!),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const liveOk = live.isSuccess ? live.data.status === 200 && live.data.data.status === 'ok' : null;
  const readyOk = ready.isSuccess ? ready.data.status === 200 && ready.data.data.status === 'ok' : null;
  const correlationId =
    me.data?.correlationId ||
    ready.data?.correlationId ||
    live.data?.correlationId ||
    getLastCorrelationId() ||
    '—';

  const identityLabel = !accessToken
    ? 'no token'
    : me.isSuccess
      ? me.data.data.roles.join('+') || 'authenticated'
      : me.isError
        ? 'token error'
        : '…';

  const identityOk = !accessToken ? null : me.isSuccess ? true : me.isError ? false : null;

  return (
    <header className="status-bar">
      <div className="brand-block">
        <p className="eyebrow">IndaPlay / TV2 PoC</p>
        <h1>
          <Link to="/" className="brand-link">
            API playground
          </Link>
        </h1>
      </div>
      <dl className="status-grid">
        <div>
          <dt>API base</dt>
          <dd className="mono">{apiBaseLabel()}</dd>
        </div>
        <div>
          <dt>live</dt>
          <dd>
            <span className={pillClass(liveOk)}>{liveOk === null ? '…' : liveOk ? 'ok' : 'down'}</span>
          </dd>
        </div>
        <div>
          <dt>ready</dt>
          <dd>
            <span className={pillClass(readyOk)}>{readyOk === null ? '…' : readyOk ? 'ok' : 'not ready'}</span>
          </dd>
        </div>
        <div>
          <dt>identity</dt>
          <dd>
            <span className={pillClass(identityOk)}>{identityLabel}</span>
          </dd>
        </div>
        <div>
          <dt>correlationId</dt>
          <dd className="mono truncate">{correlationId}</dd>
        </div>
        <div>
          <dt>OpenAPI</dt>
          <dd>
            <a href={backendDocsUrl('/docs')} target="_blank" rel="noreferrer">
              /docs
            </a>
          </dd>
        </div>
      </dl>
    </header>
  );
}
