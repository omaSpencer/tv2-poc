import { describe, expect, it } from 'vitest';
import { operatorActionPollInterval } from './useOperatorAction';

describe('operator action polling', () => {
  it('uses state-aware intervals and stops in terminal or hidden states', () => {
    expect(operatorActionPollInterval('queued', 'visible')).toBe(10_000);
    expect(operatorActionPollInterval('running', 'visible')).toBe(2_000);
    expect(operatorActionPollInterval('succeeded', 'visible')).toBe(false);
    expect(operatorActionPollInterval('failed', 'visible')).toBe(false);
    expect(operatorActionPollInterval('running', 'hidden')).toBe(false);
  });
});
