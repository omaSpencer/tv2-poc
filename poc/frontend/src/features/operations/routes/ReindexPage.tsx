import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { fetchReindexPreflight, startReindex } from '../../../api/operations';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { useVisibleRefetch } from '../../../lib/useVisibleRefetch';
import { reindexPreflightPollInterval } from '../reindexPreflightPoll';
import { OperationsNav } from '../components/OperationsNav';
import { activeActionStorageKey, createIdempotencyKey } from '../idempotency';
import { operationsKeys } from '../queryKeys';
import { availabilityLabel, REINDEX_BLOCKER_LABELS } from '../viewModel';

export function ReindexPage() {
  const navigate = useNavigate();
  const [index, setIndex] = useState<'a' | 'b'>('a');
  const [allowSearchOutage, setAllowSearchOutage] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const key = useRef(createIdempotencyKey());
  const activeRunId = sessionStorage.getItem(activeActionStorageKey('reindex'));
  const requestChanged = () => {
    key.current = createIdempotencyKey();
    mutation.reset();
  };
  const preflightQueryFn = useCallback(
    () => fetchReindexPreflight(index, allowSearchOutage),
    [index, allowSearchOutage],
  );
  const preflight = useQuery({
    queryKey: operationsKeys.preflight(index, allowSearchOutage),
    queryFn: preflightQueryFn,
    retry: false,
    refetchInterval: () => reindexPreflightPollInterval(document.visibilityState),
    refetchIntervalInBackground: false,
  });
  useVisibleRefetch(preflight.refetch, preflight.isFetching);
  const mutation = useMutation({
    mutationFn: () => startReindex({
      index,
      reason: reason.trim(),
      allowSearchOutage,
      ...(preflight.data?.data.confirmationRequired ? { confirmTarget: confirmation } : {}),
    }, key.current),
    onSuccess: response => {
      sessionStorage.setItem(activeActionStorageKey('reindex'), response.data.id);
      void navigate(`/operations/reindex/${response.data.id}`);
    },
  });
  const status = preflight.data?.data;
  const confirmationOk = !status?.confirmationRequired || confirmation === status.confirmationTarget;
  const canSubmit = Boolean(status)
    && !preflight.isFetching
    && !preflight.isError
    && !mutation.isPending
    && reason.trim().length >= 3
    && confirmationOk
    && !status.blockers.includes('active_run')
    && !status.blockers.includes('search_disabled')
    && (allowSearchOutage || !status.blockers.includes('other_index_unavailable'));

  return (
    <div className="stack-pages operations-page">
      <OperationsNav />
      <section className="panel">
        <p className="eyebrow">Vezetett, tartós művelet</p>
        <h2>Teljes keresőindex-újraépítés</h2>
        <p className="muted">A futás háttérben folytatódik. Nincs megszakítás vagy középről folytatás.</p>
        {activeRunId ? <p><Link className="btn-secondary" to={`/operations/reindex/${activeRunId}`}>Aktív futás megnyitása</Link></p> : null}
      </section>
      {preflight.error ? <ProblemPanel error={preflight.error} title="A reindex előellenőrzése sikertelen" /> : null}
      <form className="panel form-stack" onSubmit={event => { event.preventDefault(); if (canSubmit) mutation.mutate(); }}>
        <fieldset>
          <legend>Célindex</legend>
          <label><input type="radio" name="index" value="a" checked={index === 'a'} onChange={() => { setIndex('a'); requestChanged(); }} /> Index A</label>
          <label><input type="radio" name="index" value="b" checked={index === 'b'} onChange={() => { setIndex('b'); requestChanged(); }} /> Index B</label>
        </fieldset>
        <label className="danger-choice">
          <input type="checkbox" checked={allowSearchOutage} onChange={event => { setAllowSearchOutage(event.target.checked); setConfirmation(''); requestChanged(); }} />
          Keresési kiesés engedélyezése, ha a másik index nem elérhető
        </label>
        {status ? (
          <section className={status.blockers.length ? 'ops-callout ops-callout-warning' : 'ops-callout'} aria-live="polite">
            <div>
              <h3>Élő előellenőrzés</h3>
              <p>Másik index: {status.otherIndex.toUpperCase()} · készen áll: {availabilityLabel(status.otherIndexReady)} · elérhető: {availabilityLabel(status.otherIndexReachable)}</p>
              <p>Akadályok: {status.blockers.length ? status.blockers.map(blocker => REINDEX_BLOCKER_LABELS[blocker]).join(', ') : 'nincs'}</p>
            </div>
          </section>
        ) : <p role="status">Előellenőrzés…</p>}
        <label>Indoklás
          <textarea value={reason} minLength={3} maxLength={500} required onChange={event => { setReason(event.target.value); requestChanged(); }} />
        </label>
        {status?.confirmationRequired ? (
          <label>Pontos adatbázisnév megerősítése: <strong className="mono">{status.confirmationTarget}</strong>
            <input value={confirmation} autoComplete="off" onChange={event => { setConfirmation(event.target.value); requestChanged(); }} />
          </label>
        ) : null}
        {mutation.error ? <ProblemPanel error={mutation.error} title="A reindex nem indítható" /> : null}
        <button type="submit" className="btn-danger" disabled={!canSubmit}>{mutation.isPending ? 'Indítás…' : 'Teljes reindex indítása'}</button>
      </form>
    </div>
  );
}
