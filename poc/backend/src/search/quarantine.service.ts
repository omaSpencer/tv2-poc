import { Inject, Injectable } from '@nestjs/common';
import { contentEventV1Schema } from '../contracts/events.js';
import { searchQuarantineV1Schema, type SearchQuarantineV1 } from '../contracts/search.js';
import { ContentRepository } from '../content/content.repository.js';
import { DatabaseService } from '../database.js';
import { JetStreamAdapter } from '../messaging/jetstream.adapter.js';
import { OperatorActionExecutionError } from '../ops/operator-action.error.js';
import { SEARCH_BROKER } from './search.registry.js';

const MAX_SCAN = 2000;

function parseJson(data: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
}

export type QuarantineItem = {
  sequence: number;
  schemaValid: boolean;
  quarantineId: string | null;
  failedAt: string | null;
  errorCode: string | null;
  originalEventId: string | null;
  originalStream: string | null;
  originalSequence: number | null;
  subject: string | null;
  durable: string | null;
};

export type QuarantineList = { items: QuarantineItem[]; nextBeforeSequence: number | null };

@Injectable()
export class QuarantineService {
  constructor(
    @Inject(SEARCH_BROKER) private readonly broker: JetStreamAdapter,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ContentRepository) private readonly repository: ContentRepository,
  ) {}

  private item(sequence: number, record: SearchQuarantineV1 | null): QuarantineItem {
    return record === null ? {
      sequence,
      schemaValid: false,
      quarantineId: null,
      failedAt: null,
      errorCode: null,
      originalEventId: null,
      originalStream: null,
      originalSequence: null,
      subject: null,
      durable: null,
    } : {
      sequence,
      schemaValid: true,
      quarantineId: record.quarantineId,
      failedAt: record.failedAt,
      errorCode: record.errorCode,
      originalEventId: record.originalEventId,
      originalStream: record.originalStream,
      originalSequence: record.originalStreamSequence,
      subject: record.originalSubject,
      durable: record.durable,
    };
  }

  async inspect(sequence: number): Promise<QuarantineItem> {
    const stored = await this.broker.storedMessage(this.broker.names.quarantineStream, sequence);
    if (stored === null) throw new OperatorActionExecutionError('quarantine_not_found');
    const parsed = searchQuarantineV1Schema.safeParse(parseJson(stored.data));
    return this.item(sequence, parsed.success ? parsed.data : null);
  }

  async list(options: { beforeSequence: number | null; limit: number }): Promise<QuarantineList> {
    const bounds = await this.broker.streamBounds(this.broker.names.quarantineStream);
    if (bounds.messages === 0) return { items: [], nextBeforeSequence: null };
    let sequence = Math.min(options.beforeSequence === null ? bounds.lastSequence + 1 : options.beforeSequence, bounds.lastSequence + 1) - 1;
    const items: QuarantineItem[] = [];
    let scanned = 0;
    while (sequence >= bounds.firstSequence && items.length < options.limit + 1 && scanned < MAX_SCAN) {
      const stored = await this.broker.storedMessage(this.broker.names.quarantineStream, sequence);
      if (stored !== null) {
        const parsed = searchQuarantineV1Schema.safeParse(parseJson(stored.data));
        items.push(this.item(sequence, parsed.success ? parsed.data : null));
      }
      sequence -= 1;
      scanned += 1;
    }
    const hasMore = items.length > options.limit;
    const visible = hasMore ? items.slice(0, options.limit) : items;
    return {
      items: visible,
      nextBeforeSequence: hasMore ? visible.at(-1)!.sequence : null,
    };
  }

  async replay(sequence: number, _reason?: string, _actionId?: string): Promise<{
    sequence: number;
    quarantineId: string;
    originalSequence: number;
    replaySequence: number;
    duplicate: boolean;
  }> {
    const quarantined = await this.broker.storedMessage(this.broker.names.quarantineStream, sequence);
    if (quarantined === null) throw new OperatorActionExecutionError('quarantine_not_found');
    const summary = searchQuarantineV1Schema.safeParse(parseJson(quarantined.data));
    if (!summary.success) throw new OperatorActionExecutionError('quarantine_schema_invalid');
    const record = summary.data;
    const original = await this.broker.storedMessage(record.originalStream, record.originalStreamSequence);
    if (original === null) throw new OperatorActionExecutionError('quarantine_original_expired');
    const event = contentEventV1Schema.safeParse(parseJson(original.data));
    if (!event.success) throw new OperatorActionExecutionError('quarantine_schema_invalid');
    if (!(await this.repository.findById(this.database.db, event.data.aggregateId))) {
      throw new OperatorActionExecutionError('quarantine_aggregate_unknown');
    }
    const published = await this.broker.publishTo(
      this.broker.names.subject,
      original.data,
      `replay:${record.quarantineId}`,
    );
    return {
      sequence,
      quarantineId: record.quarantineId,
      originalSequence: record.originalStreamSequence,
      replaySequence: published.streamSeq,
      duplicate: published.duplicate,
    };
  }
}
