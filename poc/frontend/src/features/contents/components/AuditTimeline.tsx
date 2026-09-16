import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isApiProblemError } from '../../../api/types';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { listContentAudit } from '../api';
import { contentKeys } from '../queryKeys';
import { formatDateTime } from './format';

const ACTION_LABELS: Record<string, string> = {
  created: 'Létrehozva', updated: 'Módosítva', published: 'Publikálva', withdrawn: 'Visszavonva',
};

export function AuditTimeline({ contentId }: { contentId: string }) {
  const queryClient = useQueryClient();
  const audit = useInfiniteQuery({
    queryKey: contentKeys.audit(contentId, null),
    queryFn: ({ pageParam }) => listContentAudit(contentId, { limit: 20, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.data.nextCursor ?? undefined,
    retry: false,
  });

  useEffect(() => {
    if (audit.isError && isApiProblemError(audit.error) && audit.error.problem.status === 404) {
      void queryClient.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    }
  }, [audit.error, audit.isError, contentId, queryClient]);

  const items = audit.data?.pages.flatMap(page => page.data.items) ?? [];
  return (
    <section className="panel">
      <h2>Audit idővonal</h2>
      {audit.isPending ? <p role="status">Audit betöltése…</p> : null}
      {audit.isError ? <ProblemPanel error={audit.error} title="Az audit nem tölthető be" /> : null}
      {!audit.isPending && !audit.isError && items.length === 0 ? (
        <p className="field-error" role="alert">A tartalom létezik, de nem tartozik hozzá auditbejegyzés.</p>
      ) : null}
      {items.length > 0 ? (
        <ol className="audit-timeline">
          {items.map(item => (
            <li key={item.id}>
              <div className="audit-marker" aria-hidden="true" />
              <div className="audit-entry">
                <h3>{ACTION_LABELS[item.action] ?? item.action} · v{item.contentVersion}</h3>
                <p>{formatDateTime(item.occurredAt)} · <span className="mono">{item.actorSub}</span></p>
                <p className="muted">Szerepek: {item.actorRoles.join(', ') || '—'} · Módosult: {item.changedFields.join(', ') || '—'}</p>
                <details><summary>Technikai részletek</summary><p className="mono">correlationId: {item.correlationId} <button type="button" className="copy-button" onClick={() => void navigator.clipboard?.writeText(item.correlationId)}>Másolás</button></p></details>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {audit.hasNextPage ? (
        <button type="button" className="btn-secondary" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
          {audit.isFetchingNextPage ? 'Betöltés…' : 'Korábbi események'}
        </button>
      ) : null}
    </section>
  );
}
