import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchProcessingStatus } from '../../../api/processing';
import { JsonBlock } from '../../../components/JsonBlock';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { ConsumersPanel } from '../components/ConsumersPanel';
import { IndexStatusCard } from '../components/IndexStatusCard';
import { ServiceCards } from '../components/ServiceCards';
import { StatusBadge } from '../components/StatusBadge';
import { TimestampValue } from '../components/TimestampValue';
import { operationsKeys } from '../queryKeys';
import {
  isAuthorizationError,
  processingPollInterval,
  searchAvailability,
} from '../viewModel';

export function OperationsPage() {
  const statusQuery = useQuery({
    queryKey: operationsKeys.status(),
    queryFn: fetchProcessingStatus,
    retry: false,
    refetchInterval: query => processingPollInterval({
      status: query.state.data?.data,
      error: query.state.error,
      failureCount: query.state.fetchFailureCount,
      visibilityState: document.visibilityState,
    }),
    refetchIntervalInBackground: false,
  });
  const { error, isFetching, refetch } = statusQuery;

  useEffect(() => {
    const refetchWhenVisible = () => {
      if (document.visibilityState === 'visible' && !isFetching && !isAuthorizationError(error)) {
        void refetch();
      }
    };
    document.addEventListener('visibilitychange', refetchWhenVisible);
    return () => document.removeEventListener('visibilitychange', refetchWhenVisible);
  }, [error, isFetching, refetch]);

  const response = statusQuery.data;
  const status = response?.data;
  const availability = status ? searchAvailability(status) : null;
  const updatedAt = statusQuery.dataUpdatedAt > 0
    ? new Date(statusQuery.dataUpdatedAt).toISOString()
    : null;
  const stale = Boolean(status && error);
  const canRetry = !isAuthorizationError(error);

  return (
    <div className="stack-pages operations-page">
      <section className="panel operations-heading">
        <div>
          <p className="eyebrow">Read-only megfigyelés</p>
          <h2>Operációs dashboard</h2>
          <p className="muted">Outbox, relay, broker, durable consumerek és A/B keresőindexek egy nézetben.</p>
        </div>
        <div className="operations-refresh">
          <button type="button" className="btn-secondary" disabled={isFetching || !canRetry} onClick={() => void refetch()}>
            {isFetching ? 'Frissítés…' : 'Frissítés most'}
          </button>
          <p className="muted operations-updated">
            Utolsó sikeres frissítés: <TimestampValue value={updatedAt} />
          </p>
        </div>
      </section>

      {stale ? (
        <section className="panel ops-callout ops-callout-warning" role="alert">
          <div>
            <h2>Elavult adatok</h2>
            <p>A legutóbbi frissítés sikertelen volt; az utolsó sikeres snapshot maradt a képernyőn.</p>
          </div>
          {canRetry ? (
            <button type="button" className="btn-secondary" disabled={isFetching} onClick={() => void refetch()}>
              Újrapróbálás
            </button>
          ) : null}
        </section>
      ) : null}

      {stale ? <ProblemPanel error={error} title="Az utolsó frissítés hibája" /> : null}

      {error && !status ? (
        <>
          <ProblemPanel error={error} title="A feldolgozási állapot nem tölthető be" />
          {canRetry ? (
            <button type="button" className="btn-secondary operations-retry" disabled={isFetching} onClick={() => void refetch()}>
              Újrapróbálás
            </button>
          ) : null}
        </>
      ) : null}

      {statusQuery.isPending && !status ? (
        <section className="panel" role="status">
          <h2>Operációs adatok betöltése…</h2>
          <p className="muted">A dashboard az első feldolgozási snapshotra vár.</p>
        </section>
      ) : null}

      {status && availability ? (
        <>
          <section className={`panel operations-overview operations-overview-${availability.tone}`} aria-labelledby="search-availability-title">
            <div>
              <p className="eyebrow">Összesített keresési állapot</p>
              <h2 id="search-availability-title">{availability.label}</h2>
              <p>{availability.detail}</p>
            </div>
            <StatusBadge tone={availability.tone}>{availability.label}</StatusBadge>
          </section>

          <ServiceCards status={status} />

          <ConsumersPanel
            consumers={status.consumers}
            unavailable={status.consumersUnavailable === true}
          />

          {status.indexes ? (
            <div className="operations-index-grid">
              <IndexStatusCard alias="a" index={status.indexes.a} />
              <IndexStatusCard alias="b" index={status.indexes.b} />
            </div>
          ) : (
            <section className="panel panel-muted" role="status">
              <h2>A/B indexállapot nem elérhető</h2>
              <p>Ez a konfiguráció nem adott vissza indexdiagnosztikát.</p>
            </section>
          )}

          <section className="panel operations-technical">
            <details>
              <summary>Technikai részletek és nyers válasz</summary>
              <dl className="kv compact-kv top-gap">
                <div><dt>HTTP státusz</dt><dd>{response.status}</dd></div>
                <div><dt>correlationId</dt><dd className="mono">{response.correlationId || 'nincs adat'}</dd></div>
              </dl>
              <JsonBlock value={status} />
            </details>
          </section>
        </>
      ) : null}
    </div>
  );
}
