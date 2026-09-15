/**
 * GET /admin/processing-status (M3-05). Requires ops:read. Broker outages are
 * reported in the body — never as HTTP 500. DB outages remain 503.
 */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PermissionGuard, RequirePermission } from '../content/permission.guard.js';
import { DatabaseService, isConnectionFailure } from '../database.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';
import { ApiError } from '../contracts/errors.js';
import { JetStreamAdapter } from '../messaging/jetstream.adapter.js';
import { RelayState } from '../messaging/relay.state.js';

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
  consumers?: Array<{ name: string; pending: number }>;
  quarantine?: { pending: number };
  consumersUnavailable?: boolean;
};

@ApiTags('admin')
@Controller('admin')
@UseGuards(PermissionGuard)
export class ProcessingStatusController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(JetStreamAdapter) private readonly broker: JetStreamAdapter,
    @Inject(RelayState) private readonly relay: RelayState,
  ) {}

  @Get('processing-status')
  @RequirePermission('ops:read')
  @ApiOperation({ summary: 'Outbox and relay processing status' })
  @ApiResponse({ status: 200, description: 'Best-effort snapshot of outbox, relay and broker state' })
  @ApiResponse({ status: 401, description: 'unauthenticated' })
  @ApiResponse({ status: 403, description: 'forbidden' })
  @ApiResponse({ status: 503, description: 'dependency_unavailable when the database is down' })
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

    if (!relayEnabled) return view;

    const snapshot = await this.broker.snapshot();
    view.broker.connected = snapshot.connected;
    view.broker.streamPresent = snapshot.streamPresent;
    if (snapshot.consumers) {
      view.consumers = snapshot.consumers;
    } else {
      view.consumersUnavailable = true;
    }
    if (snapshot.quarantinePending !== null) {
      view.quarantine = { pending: snapshot.quarantinePending };
    }
    return view;
  }
}
