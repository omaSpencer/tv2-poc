/** D08 retry ladder. The final delay repeats after the ladder is exhausted. */
export const D08_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16_000, 30_000] as const;
export const D08_RETRY_JITTER = 0.2;

function retryBaseMs(attempt: number, delays: readonly number[]): number {
  if (delays.length === 0) throw new RangeError('Retry delays must not be empty.');
  const index = Math.min(Math.max(Math.trunc(attempt), 0), delays.length - 1);
  return delays[index]!;
}

/** Base delay without jitter, used only for stable diagnostics. */
export function peekRetryDelayMs(
  attempt: number,
  delays: readonly number[] = D08_RETRY_DELAYS_MS,
): number {
  return retryBaseMs(attempt, delays);
}

/** Pure retry delay calculation with an injectable random source. */
export function retryDelayMs(
  attempt: number,
  delays: readonly number[] = D08_RETRY_DELAYS_MS,
  random: () => number = Math.random,
  jitterRatio = D08_RETRY_JITTER,
): number {
  const base = retryBaseMs(attempt, delays);
  const randomValue = Math.min(Math.max(random(), 0), 1);
  const jitter = base * jitterRatio * (randomValue * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}
