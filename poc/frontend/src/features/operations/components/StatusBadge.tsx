import type { ReactNode } from 'react';
import type { StatusTone } from '../viewModel';

const SYMBOLS: Record<StatusTone, string> = {
  ok: '●',
  warning: '▲',
  danger: '×',
  neutral: '○',
};

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`ops-status ops-status-${tone}`}>
      <span aria-hidden="true">{SYMBOLS[tone]}</span> {children}
    </span>
  );
}
