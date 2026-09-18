/**
 * GET /admin/processing-status (M3-05). Requires ops:read. Broker outages are
 * reported in the body — never as HTTP 500. DB outages remain 503.
 */
import { Controller, Get, Inject, Optional, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PermissionGuard, RequirePermission } from '../content/permission.guard.js';
import { DatabaseService, isConnectionFailure } from '../database.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { ApiError } from '../contracts/errors.js';
import { jsonResponse, problemResponse } from '../contracts/openapi.js';
import { JetStreamAdapter } from '../messaging/jetstream.adapter.js';
import { RelayState } from '../messaging/relay.state.js';
import { SearchRegistry } from '../search/search.registry.js';
import { SearchState, runtimeStateIsRoutable, type SearchIndexStatusSnapshot } from '../search/worker.state.js';
import { ReindexControlRepository } from '../search/reindex/control.repository.js';
import type { ReindexPhase, WorkerDesiredState } from '../schema.js';

export type ProcessingStatusView = {
  outbox: {
    pending: number;
    oldestOccurredAt: string | null;
    oldestAgeMs: number | null;
  };
  relay: {
    enabled: boolean;
    state: string;
    lastDeliveredAt: string | null;
    lastErrorCode: string | null;
  };
  broker: {
    connected: boolean;
    streamPresent: boolean | null;
  };
  consumers?: Array<{
    name: string;
    pending: number;
    ackPending: number;
    ackFloorStreamSequence: number;
    oldestUnfinishedAt: string | null;
    oldestUnfinishedAgeMs: number | null;
  }>;
  quarantine?: { pending: number };
  consumersUnavailable?: boolean;
  /**
   * Per-index worker progress (M4-07). Kept beside `consumers[].pending` rather
   * than merged into it: the broker's pending count does not necessarily
   * include the message a worker currently holds in flight, so the two numbers
   * answer different questions.
   */
  indexes?: { a: SearchIndexStatusSnapshot & DurableIndexStatus; b: SearchIndexStatusSnapshot & DurableIndexStatus };
};

type DurableIndexStatus = {
  phase: ReindexPhase | null;
  desiredWorkerState: WorkerDesiredState | null;
  runId: string | null;
  snapshotStreamSequence: number | null;
  outboxHighWater: number | null;
  catchUpStreamSequence: number | null;
  importedDocuments: number;
  expectedDocuments: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  routeEligible: boolean;
};

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(PermissionGuard)
export class ProcessingStatusController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(JetStreamAdapter) private readonly broker: JetStreamAdapter,
    @Inject(RelayState) private readonly relay: RelayState,
    @Inject(SearchRegistry) private readonly search: SearchRegistry,
    @Inject(SearchState) private readonly searchState: SearchState,
    @Optional() @Inject(ReindexControlRepository) private readonly control: ReindexControlRepository | null = null,
  ) {}

  @Get('processing-status')
  @RequirePermission('ops:read')
  @ApiOperation({ summary: 'Outbox and relay processing status' })
  @ApiResponse({
    status: 200,
    ...jsonResponse('ProcessingStatusView', 'Best-effort snapshot of outbox, relay and broker state'),
  })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:read is required') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable when the database is down') })
  async status(): Promise<ProcessingStatusView> {
    let stats: { pending: number; oldestOccurredAt: Date | null };
    try {
      stats = await this.outbox.pendingStats(this.database.db);
    } catch (error) {
      if (isConnectionFailure(error)) {
        throw new ApiError('dependency_unavailable', 'The database is currently unavailable.');
      }
      throw error;
    }

    const now = Date.now();
    const oldestOccurredAt = stats.oldestOccurredAt?.toISOString() ?? null;
    const oldestAgeMs = stats.oldestOccurredAt
      ? Math.max(0, now - stats.oldestOccurredAt.getTime())
      : null;

    const relayEnabled = this.config.getOrThrow<string>('FEATURE_OUTBOX_RELAY') === 'on';
    const relay = this.relay.snapshot();
    const view: ProcessingStatusView = {
      outbox: {
        pending: stats.pending,
        oldestOccurredAt,
        oldestAgeMs,
      },
      relay: {
        enabled: relayEnabled,
        state: relayEnabled ? relay.state : 'off',
        lastDeliveredAt: relay.lastDeliveredAt,
        lastErrorCode: relay.lastErrorCode,
      },
      broker: {
        connected: false,
        streamPresent: null,
      },
    };

    // Search state is in-memory and cannot fail; it is reported whether or not
    // the relay is on, and a Meilisearch outage shows up here, never as a 500.
    if (this.search.enabled) {
      await this.search.probeReachability();
      const runtime = this.searchState.snapshot();
      const controls = this.control === null ? [] : await this.control.all().catch(() => []);
      const byAlias = new Map(controls.map(row => [row.indexAlias, row]));
      const merged = (alias: 'a' | 'b') => {
        const row = byAlias.get(alias);
        const current = runtime[alias];
        const runtimeRoutable = runtimeStateIsRoutable(current.state);
        return {
          ...current,
          phase: (row?.phase as ReindexPhase | undefined) ?? null,
          desiredWorkerState: (row?.desiredWorkerState as WorkerDesiredState | undefined) ?? null,
          runId: row?.runId ?? null,
          snapshotStreamSequence: row?.snapshotStreamSequence ?? null,
          outboxHighWater: row?.outboxHighWater ?? null,
          catchUpStreamSequence: row?.catchUpStreamSequence ?? null,
          importedDocuments: row?.importedDocuments ?? 0,
          expectedDocuments: row?.expectedDocuments ?? null,
          startedAt: row?.startedAt?.toISOString() ?? null,
          updatedAt: row?.updatedAt?.toISOString() ?? null,
          completedAt: row?.completedAt?.toISOString() ?? null,
          // An unavailable Meilisearch instance cannot serve traffic even when
          // its worker is `idle`: without traffic the worker would never enter
          // an error state and operators would see false A/B availability. A
          // `null` (not probed yet) state is not treated as an outage.
          routeEligible: row?.phase === 'ready' && runtimeRoutable && current.reachable !== false,
        };
      };
      view.indexes = { a: merged('a'), b: merged('b') };
    }

    if (!relayEnabled) return view;

    const snapshot = await this.broker.snapshot();
    view.broker.connected = snapshot.connected;
    view.broker.streamPresent = snapshot.streamPresent;
    if (snapshot.consumers) {
      view.consumers = snapshot.consumers.map(consumer => ({
        ...consumer,
        oldestUnfinishedAgeMs: consumer.oldestUnfinishedAt === null
          ? null
          : Math.max(0, now - Date.parse(consumer.oldestUnfinishedAt)),
      }));
    } else {
      view.consumersUnavailable = true;
    }
    if (snapshot.quarantinePending !== null) {
      view.quarantine = { pending: snapshot.quarantinePending };
    }
    return view;
  }
}
