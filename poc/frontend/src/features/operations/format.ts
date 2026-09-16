export function formatDurationMs(milliseconds: number | null): string {
  if (milliseconds === null) return 'nincs adat';
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} mp`;
  if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} perc`;
  if (milliseconds < 86_400_000) return `${Math.round(milliseconds / 3_600_000)} óra`;
  return `${Math.round(milliseconds / 86_400_000)} nap`;
}

export function formatTimestamp(value: string | null): string {
  if (value === null) return 'nincs adat';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

export function progressPercent(imported: number, expected: number | null): number | null {
  if (expected === null || expected <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((imported / expected) * 100)));
}

export function formatInteger(value: number | null): string {
  return value === null ? 'nincs adat' : new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 0 }).format(value);
}
