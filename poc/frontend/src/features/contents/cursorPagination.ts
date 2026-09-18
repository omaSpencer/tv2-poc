export type CursorPaginationState = {
  cursor: string | null;
  history: Array<string | null>;
};

export type CursorPaginationAction =
  | { type: 'reset' }
  | { type: 'next'; cursor: string }
  | { type: 'previous' };

export const INITIAL_CURSOR_PAGINATION: CursorPaginationState = {
  cursor: null,
  history: [],
};

export function cursorPaginationReducer(
  state: CursorPaginationState,
  action: CursorPaginationAction,
): CursorPaginationState {
  switch (action.type) {
    case 'reset':
      return INITIAL_CURSOR_PAGINATION;
    case 'next':
      if (!action.cursor) return state;
      return {
        history: [...state.history, state.cursor],
        cursor: action.cursor,
      };
    case 'previous': {
      if (state.history.length === 0) return state;
      const history = state.history.slice(0, -1);
      return { cursor: state.history[state.history.length - 1] ?? null, history };
    }
    default:
      return state;
  }
}
