import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { fetchReindexRun } from '../../../api/operations';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { OperationsNav } from '../components/OperationsNav';
import { operationsKeys } from '../queryKeys';
import { operatorActionPollInterval } from '../useOperatorAction';
import { StatusBadge } from '../components/StatusBadge';
import { activeActionStorageKey } from '../idempotency';
import { OPERATOR_ACTION_STATE_LABELS, PHASE_LABELS } from '../viewModel';

const PHASES = ['draining', 'importing', 'swapping', 'catching_up', 'verifying', 'ready'] as const;

export function ReindexProgressPage() {
  const { runId = '' } = useParams();
  const query = useQuery({
    queryKey: operationsKeys.reindexRun(runId),
    queryFn: () => fetchReindexRun(runId),
    retry: false,
    refetchInterval: current => operatorActionPollInterval(current.state.data?.data.state, document.visibilityState),
    refetchIntervalInBackground: false,
  });
  const { refetch } = query;
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void refetch(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [refetch]);
  const run = query.data?.data;
  useEffect(() => {
    if (!runId) return;
    const storageKey = activeActionStorageKey('reindex');
    if (run?.state === 'succeeded' || run?.state === 'failed') {
      if (sessionStorage.getItem(storageKey) === runId) sessionStorage.removeItem(storageKey);
    } else {
      sessionStorage.setItem(storageKey, runId);
    }
  }, [run?.state, runId]);
  const tone = run?.state === 'succeeded' ? 'ok' : run?.state === 'failed' ? 'danger' : 'warning';
  return (
    <div className="stack-pages operations-page">
      <OperationsNav />
      {query.error ? <ProblemPanel error={query.error} title="A reindex futása nem tölthető be" /> : null}
      {!run ? <section className="panel" role="status">A futás betöltődik…</section> : (
        <section className="panel operator-action-panel" aria-live="polite">
          <div className="section-heading-row"><div><p className="eyebrow">Index {(run.target as { index?: string }).index?.toUpperCase()}</p><h2>Reindex folyamat</h2></div><StatusBadge tone={tone}>{OPERATOR_ACTION_STATE_LABELS[run.state]}</StatusBadge></div>
          <ol className="phase-stepper">
            {PHASES.map(phase => <li key={phase} aria-current={run.progress?.phase === phase ? 'step' : undefined}>{PHASE_LABELS[phase]}</li>)}
          </ol>
          <dl className="kv compact-kv">
            <div><dt>Importált / várt</dt><dd>{run.progress?.importedDocuments ?? 0} / {run.progress?.expectedDocuments ?? '—'}</dd></div>
            <div><dt>S0 / H / S1</dt><dd className="mono">{run.progress?.snapshotStreamSequence ?? '—'} / {run.progress?.outboxHighWater ?? '—'} / {run.progress?.catchUpStreamSequence ?? '—'}</dd></div>
            <div><dt>Hibakód</dt><dd className="mono">{run.errorCode ?? run.progress?.errorCode ?? '—'}</dd></div>
          </dl>
          {run.state === 'failed' ? <p><Link className="btn-secondary" to="/operations/reindex">Új teljes futás</Link></p> : null}
        </section>
      )}
    </div>
  );
}
