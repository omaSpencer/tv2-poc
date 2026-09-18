/** Visible-tab preflight refresh; hidden tabs pause via `refetchIntervalInBackground`. */
export const REINDEX_PREFLIGHT_POLL_MS = 8_000;

export function reindexPreflightPollInterval(visibility: DocumentVisibilityState): number | false {
  return visibility === 'visible' ? REINDEX_PREFLIGHT_POLL_MS : false;
}
