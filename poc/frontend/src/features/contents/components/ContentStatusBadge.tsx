import type { ContentStatus } from '../../../api/types';

const LABELS: Record<ContentStatus, string> = {
  draft: 'Piszkozat',
  published: 'Publikált',
  withdrawn: 'Visszavont',
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return <span className={`content-status content-status-${status}`}>{LABELS[status]}</span>;
}
