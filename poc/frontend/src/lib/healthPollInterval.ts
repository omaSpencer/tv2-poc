/** Successful live/ready poll cadence. Consecutive failures back off from this base. */
export const HEALTH_POLL_SUCCESS_MS = 10_000;
export const HEALTH_POLL_MAX_MS = 80_000;
export const HEALTH_POLL_JITTER_RATIO = 0.1;

export type HealthPollIntervalInput = {
  consecutiveFailures: number;
  visibilityState: DocumentVisibilityState;
  /** Return a signed offset in `[-spreadMs, spreadMs]`. Defaults to limited random jitter. */
  jitter?: (spreadMs: number) => number;
};

export function defaultHealthPollJitter(spreadMs: number): number {
  if (spreadMs <= 0) return 0;
  return Math.floor(Math.random() * (spreadMs * 2 + 1)) - spreadMs;
}

/**
 * Per-query health refetch delay. Hidden tabs return `false` (no timer).
 * Success is a fixed 10s beat; consecutive failures use capped exponential
 * backoff with limited jitter. The first success is `consecutiveFailures: 0`.
 *
 * Do not use React Query `fetchFailureCount` here: it resets to 0 when a
 * fetch starts, which would collapse backoff to the success cadence mid-outage.
 */
export function healthPollInterval(input: HealthPollIntervalInput): number | false {
  if (input.visibilityState !== 'visible') return false;
  if (input.consecutiveFailures <= 0) return HEALTH_POLL_SUCCESS_MS;

  const unjittered = Math.min(
    HEALTH_POLL_MAX_MS,
    HEALTH_POLL_SUCCESS_MS * (2 ** input.consecutiveFailures),
  );
  const spreadMs = Math.floor(unjittered * HEALTH_POLL_JITTER_RATIO);
  const jitter = (input.jitter ?? defaultHealthPollJitter)(spreadMs);
  return Math.min(HEALTH_POLL_MAX_MS, Math.max(HEALTH_POLL_SUCCESS_MS, unjittered + jitter));
}

/** Consecutive queryFn failures that survive the next in-flight fetch start. */
export function createFailureTracker() {
  let consecutiveFailures = 0;
  return {
    get consecutiveFailures() {
      return consecutiveFailures;
    },
    wrap<T>(queryFn: () => Promise<T>, isFailure: (result: T) => boolean = () => false): () => Promise<T> {
      return async () => {
        try {
          const result = await queryFn();
          consecutiveFailures = isFailure(result) ? consecutiveFailures + 1 : 0;
          return result;
        } catch (error) {
          consecutiveFailures += 1;
          throw error;
        }
      };
    },
  };
}
