import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '../api/me';
import { fetchProcessingStatus } from '../api/processing';
import { isApiProblemError } from '../api/types';
import { useAuthSession } from '../auth/session';
import { can } from '../components/PermissionHints';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { ProblemPanel } from '../components/ProblemPanel';

export function ProcessingPage() {
  const { accessToken } = useAuthSession();

  const me = useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken!),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const status = useQuery({
    queryKey: ['processing', accessToken],
    queryFn: () => fetchProcessingStatus(accessToken!),
    enabled: Boolean(accessToken),
    retry: false,
    refetchInterval: 5_000,
  });

  const meData = me.data?.data ?? null;
  const needsOps = meData !== null && !can(meData, 'ops:read');

  const blocked =
    status.isError &&
    isApiProblemError(status.error) &&
    (status.error.problem.code === 'dependency_unavailable' ||
      status.error.problem.status === 404 ||
      status.error.problem.status === 503);

  const outbox = status.data?.data.outbox;

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Feldolgozási állapot (M3)</h2>
        <p className="muted">
          <code className="mono">GET /admin/processing-status</code> — <code className="mono">ops:read</code>{' '}
          (publisher). Outbox pending / oldest-age; a CMS readiness ettől külön van.
        </p>
        <p className="note">
          Publikálás után: a DB-ben published állapot nem jelenti, hogy a tartalom azonnal kereshető
          (aszinkron outbox → JetStream → index).
        </p>

        <MilestoneGate
          milestone="M3"
          feature="Outbox relay + processing-status"
          detail="A végpont M3-ban készül el; addig 404/503 várható."
        />

        {!accessToken ? (
          <p className="muted">Bearer token kell (Auth oldal). Publisher szerep ajánlott.</p>
        ) : null}
        {needsOps ? (
          <p className="field-error">
            A jelenlegi tokennek nincs <code className="mono">ops:read</code> joga – 403 várható.
          </p>
        ) : null}

        <button
          type="button"
          className="btn-secondary"
          disabled={!accessToken || status.isFetching}
          onClick={() => void status.refetch()}
        >
          Frissítés
        </button>
      </section>

      {blocked ? (
        <MilestoneGate
          milestone="M3"
          feature="processing-status"
          detail="A feature még nincs a futó backendben, vagy identity/NATS ki van kapcsolva."
        />
      ) : null}

      {status.isError ? <ProblemPanel error={status.error} title="Processing hiba" /> : null}

      {status.isSuccess ? (
        <section className="panel">
          <p className="muted">
            HTTP {status.data.status} · correlationId{' '}
            <span className="mono">{status.data.correlationId || '—'}</span>
          </p>
          {outbox ? (
            <dl className="kv">
              <div>
                <dt>outbox.pending</dt>
                <dd className="mono">{outbox.pending ?? '—'}</dd>
              </div>
              <div>
                <dt>oldestAgeSeconds</dt>
                <dd className="mono">{outbox.oldestAgeSeconds ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Nincs strukturált outbox mező – nyers JSON alább.</p>
          )}
          <JsonBlock value={status.data.data} />
        </section>
      ) : null}
    </div>
  );
}
