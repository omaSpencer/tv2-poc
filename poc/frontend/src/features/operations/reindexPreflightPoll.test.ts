import { describe, expect, it } from 'vitest';
import { REINDEX_PREFLIGHT_POLL_MS, reindexPreflightPollInterval } from './reindexPreflightPoll';

describe('reindexPreflightPollInterval', () => {
  it('uses an 8s visible cadence and pauses while hidden', () => {
    expect(reindexPreflightPollInterval('visible')).toBe(REINDEX_PREFLIGHT_POLL_MS);
    expect(reindexPreflightPollInterval('hidden')).toBe(false);
  });
});
