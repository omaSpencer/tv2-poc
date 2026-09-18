import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { startContentRepair } from '../../../api/operations';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { isUuid } from '../../../lib/uuid';
import { OperationsNav } from '../components/OperationsNav';
import { OperatorActionPanel } from '../components/OperatorActionPanel';
import { activeActionStorageKey, createIdempotencyKey } from '../idempotency';
import { operationsKeys } from '../queryKeys';

export function RepairPage() {
  const queryClient = useQueryClient();
  const [contentId, setContentId] = useState('');
  const [target, setTarget] = useState<'a' | 'b' | 'both'>('both');
  const [reason, setReason] = useState('');
  const storageKey = activeActionStorageKey('content_repair');
  const [actionId, setActionId] = useState<string | null>(() => sessionStorage.getItem(storageKey));
  const key = useRef(createIdempotencyKey());
  const mutation = useMutation({
    mutationFn: () => startContentRepair({ contentId: contentId.trim(), target, reason: reason.trim() }, key.current),
    onSuccess: response => {
      setActionId(response.data.id);
      sessionStorage.setItem(storageKey, response.data.id);
      void queryClient.invalidateQueries({ queryKey: operationsKeys.status() });
    },
  });
  const canSubmit = isUuid(contentId.trim())
    && reason.trim().length >= 3 && !mutation.isPending;
  return (
    <div className="stack-pages operations-page">
      <OperationsNav />
      <section className="panel"><p className="eyebrow">Konvergáló javítás</p><h2>Tartalom keresőprojekciójának javítása</h2><p className="muted">Az aktuális PostgreSQL-állapot az igazságforrás; a művelet nem fogad payloadot.</p></section>
      <form className="panel form-stack" onSubmit={event => { event.preventDefault(); if (canSubmit) mutation.mutate(); }}>
        <label>Tartalom UUID<input value={contentId} required onChange={event => { setContentId(event.target.value); setActionId(null); key.current = createIdempotencyKey(); }} /></label>
        <label>Célindex<select value={target} onChange={event => { setTarget(event.target.value as 'a' | 'b' | 'both'); key.current = createIdempotencyKey(); }}><option value="both">A és B</option><option value="a">A</option><option value="b">B</option></select></label>
        <label>Indoklás<textarea value={reason} required minLength={3} maxLength={500} onChange={event => { setReason(event.target.value); key.current = createIdempotencyKey(); mutation.reset(); }} /></label>
        {mutation.error ? <ProblemPanel error={mutation.error} title="A javítás nem indítható" /> : null}
        <button type="submit" className="btn-danger" disabled={!canSubmit}>{mutation.isPending ? 'Indítás…' : 'Javítás indítása'}</button>
      </form>
      {actionId ? <OperatorActionPanel actionId={actionId} title="Javítás állapota" storageKey={storageKey} /> : null}
    </div>
  );
}
