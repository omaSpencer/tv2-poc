/**
 * D-M0-05 / M1 §2.2 – slug generation.
 *
 * The server generates a slug only inside the publish transaction, from the
 * title read there. A manual slug is validated, never transliterated silently.
 */
import { LIMITS } from '../schema.js';

/** Hungarian letters that do not decompose to a plain ASCII base character. */
const EXTRA_TRANSLITERATION: Readonly<Record<string, string>> = {
  ő: 'o', ű: 'u', ß: 'ss', đ: 'd', ł: 'l', ø: 'o', æ: 'ae', œ: 'oe',
};

export function slugify(title: string): string {
  let lowered = title.toLowerCase();
  for (const [from, to] of Object.entries(EXTRA_TRANSLITERATION)) {
    lowered = lowered.replaceAll(from, to);
  }
  return lowered
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Truncation may leave a trailing hyphen; the final slug never keeps one. */
function clamp(value: string, max: number): string {
  return value.slice(0, Math.max(0, max)).replace(/-+$/g, '');
}

/**
 * Base candidate, then `-2` … `-50`. The stem is shortened so the suffixed slug
 * still fits the length limit. An empty base yields no candidate at all, which
 * the caller turns into a 422 asking for a manual slug.
 */
export function slugCandidates(title: string): string[] {
  const base = clamp(slugify(title), LIMITS.slug);
  if (base.length === 0) return [];
  const candidates = [base];
  for (let suffix = 2; suffix <= LIMITS.slugCandidates; suffix += 1) {
    const marker = `-${suffix}`;
    const stem = clamp(base, LIMITS.slug - marker.length);
    if (stem.length === 0) break;
    candidates.push(`${stem}${marker}`);
  }
  return candidates;
}
