import { describe, expect, it } from 'vitest';
import { cursorPaginationReducer, INITIAL_CURSOR_PAGINATION } from './cursorPagination';

describe('cursorPaginationReducer', () => {
  it('advances, rewinds and resets as a single pure transition', () => {
    const page2 = cursorPaginationReducer(INITIAL_CURSOR_PAGINATION, { type: 'next', cursor: 'c2' });
    expect(page2).toEqual({ cursor: 'c2', history: [null] });
    const page3 = cursorPaginationReducer(page2, { type: 'next', cursor: 'c3' });
    expect(page3).toEqual({ cursor: 'c3', history: [null, 'c2'] });
    expect(cursorPaginationReducer(page3, { type: 'previous' })).toEqual(page2);
    expect(cursorPaginationReducer(page2, { type: 'reset' })).toEqual(INITIAL_CURSOR_PAGINATION);
  });

  it('is idempotent when StrictMode re-runs the updater with the same state', () => {
    const start = { cursor: 'c2', history: [null] };
    const first = cursorPaginationReducer(start, { type: 'previous' });
    const second = cursorPaginationReducer(start, { type: 'previous' });
    expect(first).toEqual(second);
    expect(first).toEqual({ cursor: null, history: [] });

    const nextA = cursorPaginationReducer(start, { type: 'next', cursor: 'c3' });
    const nextB = cursorPaginationReducer(start, { type: 'next', cursor: 'c3' });
    expect(nextA).toEqual(nextB);
    expect(nextA).toEqual({ cursor: 'c3', history: [null, 'c2'] });
  });
});
