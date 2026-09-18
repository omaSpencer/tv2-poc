import type { ProcessingStatus } from '../../../api/types';
import { formatInteger, progressPercent } from '../format';
import { INDEX_STATE_LABELS, PHASE_LABELS, indexStateTone } from '../viewModel';
import { StatusBadge } from './StatusBadge';
import { TimestampValue } from './TimestampValue';

type IndexStatus = NonNullable<ProcessingStatus['indexes']>['a'];

function reachability(index: IndexStatus) {
  if (index.reachable === null) return <StatusBadge tone="neutral">Ismeretlen elérhetőség</StatusBadge>;
  return index.reachable
    ? <StatusBadge tone="ok">Elérhető</StatusBadge>
    : <StatusBadge tone="danger">Nem elérhető</StatusBadge>;
}

export function IndexStatusCard({ alias, index }: { alias: 'a' | 'b'; index: IndexStatus }) {
  const percent = progressPercent(index.importedDocuments, index.expectedDocuments);
  const phaseLabel = index.phase === null ? 'Nincs tartós futás' : PHASE_LABELS[index.phase];
  const runId = index.runId;

  return (
    <section className={`panel index-card index-card-${indexStateTone(index.state)}`} aria-labelledby={`index-${alias}-title`}>
      <header className="index-card-header">
        <div>
          <p className="eyebrow">Keresőindex</p>
          <h2 id={`index-${alias}-title`}>Index {alias.toUpperCase()}</h2>
        </div>
        <StatusBadge tone={index.routeEligible ? 'ok' : 'danger'}>
          {index.routeEligible ? 'Routolható' : 'Nem routolható'}
        </StatusBadge>
      </header>

      <div className="ops-status-row">
        <StatusBadge tone={indexStateTone(index.state)}>{INDEX_STATE_LABELS[index.state]}</StatusBadge>
        <StatusBadge tone={index.phase === 'failed' ? 'danger' : index.phase && index.phase !== 'ready' ? 'warning' : index.phase === 'ready' ? 'ok' : 'neutral'}>
          {phaseLabel}
        </StatusBadge>
        {reachability(index)}
      </div>

      <dl className="kv compact-kv">
        <div><dt>Durable</dt><dd className="mono">{index.durable}</dd></div>
        <div><dt>Elvárt worker</dt><dd>{index.desiredWorkerState === null ? 'nincs adat' : index.desiredWorkerState === 'running' ? 'Fut' : 'Szünetel'}</dd></div>
        <div><dt>Folyamatban lévő esemény</dt><dd className="mono">{index.inFlightEventId ?? 'nincs'}</dd></div>
        <div><dt>Folyamatban lévő feladat</dt><dd>{formatInteger(index.inFlightTaskUid)}</dd></div>
        <div><dt>Utolsó ACK</dt><dd><TimestampValue value={index.lastAckedAt} /></dd></div>
        <div><dt>Utolsó hibakód</dt><dd className="mono">{index.lastErrorCode ?? 'nincs'}</dd></div>
      </dl>

      <div className="index-progress">
        <div><strong>Importálás</strong><span>{formatInteger(index.importedDocuments)} / {formatInteger(index.expectedDocuments)}</span></div>
        {percent === null ? <p className="muted">Százalék nem számítható ismert, pozitív célérték nélkül.</p> : (
          <>
            <progress max={100} value={percent} aria-label={`Index ${alias.toUpperCase()} importálási folyamat`} />
            <span>{percent}%</span>
          </>
        )}
      </div>

      <details>
        <summary>Technikai futásrészletek</summary>
        <dl className="kv compact-kv top-gap">
          <div><dt>runId</dt><dd className="mono">{runId ?? 'nincs adat'}{runId ? <button type="button" className="copy-button" onClick={() => void navigator.clipboard?.writeText(runId)}>Másolás</button> : null}</dd></div>
          <div><dt>S0 · snapshot stream</dt><dd>{formatInteger(index.snapshotStreamSequence)}</dd></div>
          <div><dt>H · outbox high-water</dt><dd>{formatInteger(index.outboxHighWater)}</dd></div>
          <div><dt>S1 · catch-up stream</dt><dd>{formatInteger(index.catchUpStreamSequence)}</dd></div>
          <div><dt>Indult</dt><dd><TimestampValue value={index.startedAt} /></dd></div>
          <div><dt>Frissült</dt><dd><TimestampValue value={index.updatedAt} /></dd></div>
          <div><dt>Befejeződött</dt><dd><TimestampValue value={index.completedAt} /></dd></div>
        </dl>
      </details>
    </section>
  );
}
