import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

type Props = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ title, children, confirmLabel, busy = false, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy) onCancel();
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={dialogRef} className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={onKeyDown}>
        <h2 id="confirm-title">{title}</h2>
        <div>{children}</div>
        <div className="row dialog-actions">
          <button ref={cancelRef} type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Mégse</button>
          <button type="button" className="btn-danger" disabled={busy} onClick={onConfirm}>{busy ? 'Folyamatban…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
