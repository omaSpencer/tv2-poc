import { describe, expect, it } from 'vitest';
import { formatDurationMs, formatInteger, formatTimestamp, progressPercent } from './format';

describe('operations format helpers', () => {
  it.each([
    [null, 'nincs adat'],
    [999, '999 ms'],
    [1_500, '2 mp'],
    [90_000, '2 perc'],
    [7_200_000, '2 óra'],
    [172_800_000, '2 nap'],
  ] as const)('formats duration %s', (value, expected) => {
    expect(formatDurationMs(value)).toBe(expected);
  });

  it('keeps missing and invalid timestamps explicit', () => {
    expect(formatTimestamp(null)).toBe('nincs adat');
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatTimestamp('2026-09-16T10:00:00.000Z')).not.toBe('2026-09-16T10:00:00.000Z');
  });

  it.each([
    [25, 100, 25],
    [150, 100, 100],
    [-10, 100, 0],
    [10, null, null],
    [10, 0, null],
  ] as const)('calculates progress %s/%s', (imported, expected, result) => {
    expect(progressPercent(imported, expected)).toBe(result);
  });

  it('formats integer sequences without treating null as zero', () => {
    expect(formatInteger(null)).toBe('nincs adat');
    expect(formatInteger(12_345).replaceAll(/[^0-9]/g, '')).toBe('12345');
  });
});
