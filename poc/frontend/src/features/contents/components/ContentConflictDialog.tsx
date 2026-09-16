import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { AdminContentView, PatchContentBody, ProblemDocument } from '../../../api/types';

type Props = {
  problem: ProblemDocument;
  localPatch: PatchContentBody;
  server: AdminContentView;
  onLoadServer: () => void;
  onKeepLocal: () => void;
};

function value(value: unknown): string {
  if (value === null) return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  return String(value ?? '—');
}

export function ContentConflictDialog({ problem, localPatch, server, onLoadServer, onKeepLocal }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const fields = Object.keys(localPatch).filter(field => field !== 'expectedVersion') as Array<keyof PatchContentBody>;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    return () => previous?.focus();
  }, []);
  function trap(event: KeyboardEvent) {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const controls = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={panelRef} className="dialog-panel dialog-wide" role="dialog" aria-modal="true" aria-labelledby="conflict-title" onKeyDown={trap}>
        <h2 id="conflict-title">A tartalom időközben megváltozott</h2>
        <p>A helyi módosításaid megmaradtak. Várt verzió: <strong>{problem.expectedVersion}</strong>, szerververzió: <strong>{problem.actualVersion ?? server.version}</strong>.</p>
        <div className="conflict-grid" role="table" aria-label="Helyi és szerverértékek">
          <div role="row" className="conflict-head"><span>Mező</span><span>Helyi érték</span><span>Szerverérték</span></div>
          {fields.map(field => (
            <div role="row" key={field}><strong>{field}</strong><span>{value(localPatch[field])}</span><span>{value(server[field as keyof AdminContentView])}</span></div>
          ))}
        </div>
        {server.status === 'published' ? <p className="field-error">A szerververzió már publikált, ezért a helyi módosítás nem alkalmazható újra.</p> : null}
        <div className="row dialog-actions">
          <button ref={firstRef} type="button" className="btn-secondary" onClick={onLoadServer}>Szerververzió betöltése</button>
          <button type="button" onClick={onKeepLocal}>{server.status === 'published' ? 'Részletek megnyitása' : 'Saját módosítások megtartása'}</button>
        </div>
        <p className="muted">Egyik lehetőség sem küld automatikusan új PATCH kérést.</p>
      </div>
    </div>
  );
}
