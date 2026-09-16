/**
 * Observable per-index worker state (M4-07).
 *
 * A and B keep entirely separate records: one halted instance must be visible
 * as halted without saying anything about the other. `reachable` is `null` until
 * something has actually probed the endpoint, because "unknown" and "down" lead
 * an operator to different places.
 */
import { Injectable } from '@nestjs/common';
import { SEARCH_INDEX_ALIASES, type SearchIndexAlias } from '../contracts/search.js';

export type SearchIndexRunState =
  | 'off'
  | 'bootstrapping'
  | 'idle'
  | 'processing'
  | 'retrying'
  | 'paused'
  | 'halted';

export type SearchIndexStatusSnapshot = {
  state: SearchIndexRunState;
  durable: string;
  inFlightEventId: string | null;
  inFlightTaskUid: number | null;
  lastAckedAt: string | null;
  lastErrorCode: string | null;
  reachable: boolean | null;
};

export class SearchIndexState {
  state: SearchIndexRunState = 'off';
  /** True only after this worker has verified the index configuration. */
  bootstrapped = false;
  durable = '';
  inFlightEventId: string | null = null;
  inFlightTaskUid: number | null = null;
  lastAckedAt: Date | null = null;
  lastErrorCode: string | null = null;
  reachable: boolean | null = null;

  setState(state: SearchIndexRunState): void {
    this.state = state;
  }

  /** A halted instance stays halted until an operator restarts the worker. */
  halt(code: string): void {
    this.state = 'halted';
    this.lastErrorCode = code;
  }

  setInFlight(eventId: string | null): void {
    this.inFlightEventId = eventId;
  }

  markAcked(at = new Date()): void {
    this.lastAckedAt = at;
    this.inFlightEventId = null;
    this.inFlightTaskUid = null;
    this.lastErrorCode = null;
  }

  markError(code: string): void {
    this.lastErrorCode = code;
  }

  setReachable(reachable: boolean | null): void {
    this.reachable = reachable;
  }

  setTask(taskUid: number | null): void {
    this.inFlightTaskUid = taskUid;
  }

  snapshot(): SearchIndexStatusSnapshot {
    return {
      state: this.state,
      durable: this.durable,
      inFlightEventId: this.inFlightEventId,
      inFlightTaskUid: this.inFlightTaskUid,
      lastAckedAt: this.lastAckedAt?.toISOString() ?? null,
      lastErrorCode: this.lastErrorCode,
      reachable: this.reachable,
    };
  }
}

@Injectable()
export class SearchState {
  readonly indexes: Record<SearchIndexAlias, SearchIndexState> = {
    a: new SearchIndexState(),
    b: new SearchIndexState(),
  };

  enabled = false;

  get(alias: SearchIndexAlias): SearchIndexState {
    return this.indexes[alias];
  }

  snapshot(): Record<SearchIndexAlias, SearchIndexStatusSnapshot> {
    const entries = SEARCH_INDEX_ALIASES.map(alias => [alias, this.indexes[alias].snapshot()] as const);
    return Object.fromEntries(entries) as Record<SearchIndexAlias, SearchIndexStatusSnapshot>;
  }
}

/** Runtime eligibility; the durable phase and bootstrap are checked separately. */
export function runtimeStateIsRoutable(state: SearchIndexRunState): boolean {
  return state === 'idle' || state === 'processing' || state === 'retrying';
}
