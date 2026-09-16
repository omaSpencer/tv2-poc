import type { ContentCategory } from '../../api/types';

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  film: 'Film',
  sorozat: 'Sorozat',
  hir: 'Hír',
  sport: 'Sport',
  szorakozas: 'Szórakozás',
  egyeb: 'Egyéb',
};

export function formatPublishedAt(value: string | null): string {
  if (!value) return 'Publikálási idő nem érhető el';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}
