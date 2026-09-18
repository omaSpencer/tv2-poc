import { describe, expect, it } from 'vitest';
import {
  HEALTH_POLL_MAX_MS,
  HEALTH_POLL_SUCCESS_MS,
  createFailureTracker,
  healthPollInterval,
} from './healthPollInterval';

describe('healthPollInterval', () => {
  it('keeps a 10s beat on success and pauses while hidden', () => {
    expect(healthPollInterval({ consecutiveFailures: 0, visibilityState: 'visible' })).toBe(HEALTH_POLL_SUCCESS_MS);
    expect(healthPollInterval({ consecutiveFailures: 3, visibilityState: 'hidden', jitter: () => 0 })).toBe(false);
  });

  it('uses capped exponential backoff with injectable jitter', () => {
    const none = { jitter: () => 0, visibilityState: 'visible' as const };
    expect(healthPollInterval({ consecutiveFailures: 1, ...none })).toBe(20_000);
    expect(healthPollInterval({ consecutiveFailures: 2, ...none })).toBe(40_000);
    expect(healthPollInterval({ consecutiveFailures: 3, ...none })).toBe(80_000);
    expect(healthPollInterval({ consecutiveFailures: 8, ...none })).toBe(HEALTH_POLL_MAX_MS);
    expect(healthPollInterval({ consecutiveFailures: 1, visibilityState: 'visible', jitter: spread => spread })).toBe(22_000);
    expect(healthPollInterval({ consecutiveFailures: 1, visibilityState: 'visible', jitter: spread => -spread })).toBe(18_000);
  });

  it('returns to the success cadence as soon as consecutiveFailures resets', () => {
    expect(healthPollInterval({ consecutiveFailures: 4, visibilityState: 'visible', jitter: () => 0 })).toBe(HEALTH_POLL_MAX_MS);
    expect(healthPollInterval({ consecutiveFailures: 0, visibilityState: 'visible', jitter: () => 9999 })).toBe(HEALTH_POLL_SUCCESS_MS);
  });

  it('counts consecutive queryFn failures without resetting when the next fetch starts', async () => {
    const tracker = createFailureTracker();
    let remainingFailures = 2;
    const wrapped = tracker.wrap(async () => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error('down');
      }
      return 'ok';
    });
    await expect(wrapped()).rejects.toThrow('down');
    expect(tracker.consecutiveFailures).toBe(1);
    await expect(wrapped()).rejects.toThrow('down');
    expect(tracker.consecutiveFailures).toBe(2);
    await expect(wrapped()).resolves.toBe('ok');
    expect(tracker.consecutiveFailures).toBe(0);
  });

  it('can count an unhealthy resolved response without hiding it from the caller', async () => {
    const tracker = createFailureTracker();
    const unhealthy = { status: 503 };
    const wrapped = tracker.wrap(async () => unhealthy, result => result.status !== 200);

    await expect(wrapped()).resolves.toBe(unhealthy);
    expect(tracker.consecutiveFailures).toBe(1);
  });
});
