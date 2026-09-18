import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQuarantineItem, fetchQuarantineList, replayQuarantine } from '../../../api/operations';
import { useAuth } from '../../../auth/authContext';
import { can } from '../../../auth/permissions';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { OperationsNav } from '../components/OperationsNav';
import { OperatorActionPanel } from '../components/OperatorActionPanel';
import { activeActionStorageKey, createIdempotencyKey } from '../idempotency';
import { operationsKeys } from '../queryKeys';

export function QuarantinePage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const storageKey = activeActionStorageKey('quarantine_replay');
  const [actionId, setActionId] = useState<string | null>(() => sessionStorage.getItem(storageKey));
  const key = useRef(createIdempotencyKey());
  const list = useQuery({
    queryKey: operationsKeys.quarantine(cursor),
    queryFn: () => fetchQuarantineList(cursor),
    retry: false,
  });
  const detail = useQuery({
    queryKey: operationsKeys.quarantineItem(selected ?? 0),
    queryFn: () => fetchQuarantineItem(selected!),
    enabled: selected !== null,
    retry: false,
  });
  const replay = useMutation({
    mutationFn: () => replayQuarantine(selected!, { reason: reason.trim() }, key.current),
    onSuccess: response => {
      setActionId(response.data.id);
      sessionStorage.setItem(storageKey, response.data.id);
      void queryClient.invalidateQueries({ queryKey: operationsKeys.status() });
    },
  });
  const items = list.data?.data.items ?? [];
  return (
    <div className="stack-pages operations-page">
      <OperationsNav />
      <section className="panel"><p className="eyebrow">Eseménytörzs nélküli vizsgálat</p><h2>Karantén</h2><p className="muted">A lista csak hivatkozási és hibametaadatot mutat; eseménytörzset soha.</p></section>
      {list.error ? <ProblemPanel error={list.error} title="A karantén nem tölthető be" /> : null}
      <section className="panel">
        <h2>Rekordok</h2>
        {items.length === 0 && !list.isPending ? <p>Nincs karanténrekord.</p> : null}
        <div className="operator-list">
          {items.map(item => (
            <button type="button" className="operator-list-item" key={item.sequence} onClick={() => { setSelected(item.sequence); setActionId(null); setReason(''); key.current = createIdempotencyKey(); }}>
              <span>#{item.sequence} · {item.errorCode ?? 'hibás séma'}</span>
              <span>{item.schemaValid ? item.failedAt : 'séma hibás'}</span>
            </button>
          ))}
        </div>
        {list.data?.data.nextCursor ? <button type="button" className="btn-secondary" onClick={() => setCursor(list.data!.data.nextCursor)}>Régebbiek</button> : null}
      </section>
      {detail.error ? <ProblemPanel error={detail.error} title="A karanténrekord nem tölthető be" /> : null}
      {detail.data ? (
        <section className="panel">
          <h2>Karantén #{detail.data.data.sequence}</h2>
          <dl className="kv compact-kv">
            <div><dt>Séma</dt><dd>{detail.data.data.schemaValid ? 'érvényes' : 'hibás'}</dd></div>
            <div><dt>Esemény</dt><dd className="mono">{detail.data.data.originalEventId ?? '—'}</dd></div>
            <div><dt>Eredeti sorszám</dt><dd>{detail.data.data.originalSequence ?? '—'}</dd></div>
            <div><dt>Tartós fogyasztó</dt><dd>{detail.data.data.durable ?? '—'}</dd></div>
          </dl>
          {can(me, 'ops:write') && detail.data.data.schemaValid ? (
            <form className="form-stack" onSubmit={event => { event.preventDefault(); if (reason.trim().length >= 3) replay.mutate(); }}>
              <p className="muted">A visszajátszás újra publikálja az eredeti eseményt; a karanténrekord nem törlődik.</p>
              <label>Indoklás<textarea required minLength={3} maxLength={500} value={reason} onChange={event => { setReason(event.target.value); key.current = createIdempotencyKey(); replay.reset(); }} /></label>
              {replay.error ? <ProblemPanel error={replay.error} title="A visszajátszás nem indítható" /> : null}
              <button type="submit" className="btn-danger" disabled={replay.isPending || reason.trim().length < 3}>{replay.isPending ? 'Indítás…' : 'Visszajátszás indítása'}</button>
            </form>
          ) : null}
        </section>
      ) : null}
      {actionId ? <OperatorActionPanel actionId={actionId} title="Visszajátszás állapota" storageKey={storageKey} /> : null}
    </div>
  );
}
