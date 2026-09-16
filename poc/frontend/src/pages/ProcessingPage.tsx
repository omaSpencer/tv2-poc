import { useQuery } from '@tanstack/react-query';
import { fetchProcessingStatus } from '../api/processing';
import { isApiProblemError } from '../api/types';
import { useAuth } from '../auth/authContext';
import { can } from '../auth/permissions';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { ProblemPanel } from '../components/ProblemPanel';

function formatAge(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} s`;
  return `${Math.round(milliseconds / 60_000)} min`;
}

export function ProcessingPage() {
  const { me: meData, isAuthenticated } = useAuth();

  const status = useQuery({
    queryKey: ['processing'],
    queryFn: fetchProcessingStatus,
    enabled: isAuthenticated,
    retry: false,
    refetchInterval: 5_000,
  });

  const needsOps = meData !== null && !can(meData, 'ops:read');

  const blocked =
    status.isError &&
    isApiProblemError(status.error) &&
    (status.error.problem.code === 'dependency_unavailable' ||
      status.error.problem.status === 404 ||
      status.error.problem.status === 503);

  const outbox = status.data?.data.outbox;
  const relay = status.data?.data.relay;
  const broker = status.data?.data.broker;
  const consumers = status.data?.data.consumers ?? [];
  const quarantine = status.data?.data.quarantine;
  const indexes = status.data?.data.indexes;

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

        {!isAuthenticated ? (
          <p className="muted">Bejelentkezés szükséges. Publisher szerep ajánlott.</p>
        ) : null}
        {needsOps ? (
          <p className="field-error">
            A jelenlegi tokennek nincs <code className="mono">ops:read</code> joga – 403 várható.
          </p>
        ) : null}

        <button
          type="button"
          className="btn-secondary"
          disabled={!isAuthenticated || status.isFetching}
          onClick={() => void status.refetch()}
        >
          Frissítés
        </button>
      </section>

      {blocked ? (
        <MilestoneGate
          milestone="M3"
          feature="processing-status"
          detail="A processing végpont vagy valamelyik szükséges függőség jelenleg nem elérhető."
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
                <dt>oldestOccurredAt</dt>
                <dd className="mono">{outbox.oldestOccurredAt ?? '—'}</dd>
              </div>
              <div>
                <dt>oldestAge</dt>
                <dd className="mono">{formatAge(outbox.oldestAgeMs)}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Nincs strukturált outbox mező – nyers JSON alább.</p>
          )}

          {relay && broker ? (
            <div className="ops-grid">
              <section className="subpanel">
                <h3>Relay</h3>
                <dl className="kv">
                  <div><dt>enabled</dt><dd className="mono">{String(relay.enabled)}</dd></div>
                  <div><dt>state</dt><dd className="mono">{relay.state}</dd></div>
                  <div><dt>lastDeliveredAt</dt><dd className="mono">{relay.lastDeliveredAt ?? '—'}</dd></div>
                  <div><dt>lastErrorCode</dt><dd className="mono">{relay.lastErrorCode ?? '—'}</dd></div>
                </dl>
              </section>
              <section className="subpanel">
                <h3>Broker</h3>
                <dl className="kv">
                  <div><dt>connected</dt><dd className="mono">{String(broker.connected)}</dd></div>
                  <div><dt>streamPresent</dt><dd className="mono">{broker.streamPresent === null ? '—' : String(broker.streamPresent)}</dd></div>
                  <div><dt>consumers</dt><dd className="mono">{consumers.length}</dd></div>
                  <div><dt>quarantine</dt><dd className="mono">{quarantine?.pending ?? 0}</dd></div>
                </dl>
              </section>
            </div>
          ) : null}

          {consumers.length > 0 ? (
            <section className="subpanel">
              <h3>Durable consumerek</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Név</th>
                      <th>Pending</th>
                      <th>ACK pending</th>
                      <th>ACK floor</th>
                      <th>Legrégebbi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumers.map((consumer) => (
                      <tr key={consumer.name}>
                        <td className="mono">{consumer.name}</td>
                        <td className="mono">{consumer.pending}</td>
                        <td className="mono">{consumer.ackPending}</td>
                        <td className="mono">{consumer.ackFloorStreamSequence}</td>
                        <td className="mono">{formatAge(consumer.oldestUnfinishedAgeMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {indexes ? (
            <div className="ops-grid">
              {(['a', 'b'] as const).map((alias) => {
                const index = indexes[alias];
                return (
                  <section className="subpanel" key={alias}>
                    <h3>Index {alias.toUpperCase()}</h3>
                    <dl className="kv">
                      <div><dt>state</dt><dd className="mono">{index.state}</dd></div>
                      <div><dt>reachable</dt><dd className="mono">{index.reachable === null ? '—' : String(index.reachable)}</dd></div>
                      <div><dt>phase</dt><dd className="mono">{index.phase ?? '—'}</dd></div>
                      <div><dt>routeEligible</dt><dd className="mono">{String(index.routeEligible)}</dd></div>
                      <div><dt>progress</dt><dd className="mono">{index.importedDocuments}/{index.expectedDocuments ?? '—'}</dd></div>
                      <div><dt>lastErrorCode</dt><dd className="mono">{index.lastErrorCode ?? '—'}</dd></div>
                    </dl>
                  </section>
                );
              })}
            </div>
          ) : null}
          <JsonBlock value={status.data.data} />
        </section>
      ) : null}
    </div>
  );
}
