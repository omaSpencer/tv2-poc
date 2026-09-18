import { describe, expect, it } from 'vitest';
import { hasSafeInAppHistoryPredecessor } from './inAppHistory';

describe('hasSafeInAppHistoryPredecessor', () => {
  it('uses the React Router history idx when present', () => {
    expect(hasSafeInAppHistoryPredecessor({ idx: 0, key: 'abc' }, 'xyz')).toBe(false);
    expect(hasSafeInAppHistoryPredecessor({ idx: 1, key: 'abc' }, 'default')).toBe(true);
  });

  it('falls back to a non-default location key when idx is missing', () => {
    expect(hasSafeInAppHistoryPredecessor(null, 'default')).toBe(false);
    expect(hasSafeInAppHistoryPredecessor(undefined, 'abc123')).toBe(true);
    expect(hasSafeInAppHistoryPredecessor({ key: 'other' }, 'default')).toBe(false);
  });
});
