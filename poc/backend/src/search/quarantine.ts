/**
 * Quarantine envelope (M4-05).
 *
 * The DLQ record carries a *locator*, not a copy. The original event can be up
 * to the stream's 64 KiB message limit, so wrapping it would risk a quarantine
 * publish that the DLQ itself rejects — exactly when we most need it to work.
 * Stream plus sequence identifies the original message precisely enough for M5
 * to replay it from the stream.
 *
 * The publish msgID is derived from the durable and the stream sequence, so a
 * quarantine publish whose PubAck was lost deduplicates on the retry instead of
 * writing a second record for the same poisoned message.
 */
import { randomUUID } from 'node:crypto';
import {
  QUARANTINE_SCHEMA_VERSION, searchQuarantineV1Schema,
  type QuarantineErrorCode, type SearchQuarantineV1,
} from '../contracts/search.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Best-effort recovery of the original event id from a message we could not
 * parse or validate. Returns null rather than guessing; the stream sequence
 * remains the mandatory locator either way.
 */
export function recoverEventId(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = (raw as { eventId?: unknown }).eventId;
  if (typeof candidate !== 'string' || !UUID_PATTERN.test(candidate)) return null;
  return candidate.toLowerCase();
}

export type QuarantineInput = {
  errorCode: QuarantineErrorCode;
  originalEventId: string | null;
  originalStream: string;
  originalStreamSequence: number;
  originalSubject: string;
  durable: string;
  failedAt?: Date;
};

export function buildQuarantine(input: QuarantineInput): SearchQuarantineV1 {
  const envelope = {
    quarantineId: randomUUID(),
    schemaVersion: QUARANTINE_SCHEMA_VERSION,
    failedAt: (input.failedAt ?? new Date()).toISOString(),
    errorCode: input.errorCode,
    originalEventId: input.originalEventId,
    originalStream: input.originalStream,
    originalStreamSequence: input.originalStreamSequence,
    originalSubject: input.originalSubject,
    durable: input.durable,
  };
  // Refuse to publish a record that would not validate on the way out.
  return searchQuarantineV1Schema.parse(envelope);
}

/** Stable across redeliveries of the same poisoned message on the same durable. */
export function quarantineMsgId(durable: string, streamSequence: number): string {
  return `quarantine.${durable}.${streamSequence}`;
}
