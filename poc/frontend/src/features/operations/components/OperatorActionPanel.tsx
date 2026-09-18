import { useEffect } from 'react';
import type { OperatorActionView } from '../../../api/types';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { JsonBlock } from '../../../components/JsonBlock';
import { useOperatorAction } from '../useOperatorAction';
import { StatusBadge } from './StatusBadge';
import { OPERATOR_ACTION_KIND_LABELS, OPERATOR_ACTION_STATE_LABELS } from '../viewModel';

export function OperatorActionPanel({
  actionId,
  title = 'Művelet állapota',
  storageKey,
}: {
  actionId: string;
  title?: string;
  storageKey?: string;
}) {
  const query = useOperatorAction(actionId);
  const action: OperatorActionView | undefined = query.data?.data;
  useEffect(() => {
    if (!storageKey || (action?.state !== 'succeeded' && action?.state !== 'failed')) return;
    if (sessionStorage.getItem(storageKey) === actionId) sessionStorage.removeItem(storageKey);
  }, [action?.state, actionId, storageKey]);
  if (query.error && !action) return <ProblemPanel error={query.error} title="A művelet állapota nem tölthető be" />;
  if (!action) return <section className="panel" role="status"><p>A művelet állapota betöltődik…</p></section>;
  const tone = action.state === 'succeeded' ? 'ok' : action.state === 'failed' ? 'danger' : 'warning';
  return (
    <section className="panel operator-action-panel" aria-live="polite">
      <div className="section-heading-row">
        <div><p className="eyebrow">{OPERATOR_ACTION_KIND_LABELS[action.kind]}</p><h2>{title}</h2></div>
        <StatusBadge tone={tone}>{OPERATOR_ACTION_STATE_LABELS[action.state]}</StatusBadge>
      </div>
      <dl className="kv compact-kv">
        <div><dt>Azonosító</dt><dd className="mono">{action.id}</dd></div>
        <div><dt>Indoklás</dt><dd>{action.reason}</dd></div>
        <div><dt>Indította</dt><dd>{action.requestedBy}</dd></div>
        <div><dt>Hibakód</dt><dd className="mono">{action.errorCode ?? '—'}</dd></div>
      </dl>
      {action.result ? <details><summary>Biztonságos technikai eredmény</summary><JsonBlock value={action.result} /></details> : null}
    </section>
  );
}
