/**
 * M0-13 – v1 content change event contract.
 *
 * One envelope, two event types, a closed payload. The JSON Schema published
 * under `contracts/events.v1.schema.json` is generated from this Zod schema, so
 * the TypeScript type, the runtime validator and the schema cannot drift apart.
 * No token, e-mail address or media key may appear in an event.
 */
import { z } from 'zod';
import { EVENT_TYPES, LIMITS } from '../schema.js';

export const NATS_STREAM = 'CONTENT';
export const NATS_SUBJECT = 'poc.content.changed.v1';
export const NATS_QUARANTINE_STREAM = 'CONTENT_DLQ';
export const NATS_QUARANTINE_SUBJECT = 'poc.content.quarantine.v1';
export const NATS_DURABLES = ['search-a-v1', 'search-b-v1'] as const;
export const EVENT_SCHEMA_VERSION = 1;

const correlationId = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);

const envelope = {
  eventId: z.uuid(),
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  aggregateId: z.uuid(),
  aggregateVersion: z.number().int().positive(),
  occurredAt: z.iso.datetime({ offset: false }),
  correlationId,
};

export const contentEventV1Schema = z.discriminatedUnion('eventType', [
  z.strictObject({
    ...envelope,
    eventType: z.literal('content.published'),
    payload: z.strictObject({ status: z.literal('published') }),
  }),
  z.strictObject({
    ...envelope,
    eventType: z.literal('content.withdrawn'),
    payload: z.strictObject({ status: z.literal('withdrawn') }),
  }),
]);

export type ContentEventV1 = z.infer<typeof contentEventV1Schema>;

export const contentEventV1JsonSchema = () =>
  z.toJSONSchema(contentEventV1Schema, { io: 'output' });

/** The status a given event type is allowed to carry. Mirrors the DB check. */
export const EVENT_PAYLOAD_STATUS = {
  'content.published': 'published',
  'content.withdrawn': 'withdrawn',
} as const satisfies Record<(typeof EVENT_TYPES)[number], string>;

/** Documented examples; both are validated by the contract test. */
export const CONTENT_EVENT_V1_EXAMPLES: readonly ContentEventV1[] = [
  {
    eventId: 'b3dc0396-828c-4aad-af55-5b495e8fa04e',
    schemaVersion: 1,
    eventType: 'content.published',
    aggregateId: 'fbbf8b73-151f-4931-817c-f5a10a9f31ec',
    aggregateVersion: 3,
    occurredAt: '2026-09-15T10:00:00.000Z',
    correlationId: '80696510-55ce-4b83-988b-d271021b9813',
    payload: { status: 'published' },
  },
  {
    eventId: '0a1a4f6f-1f3b-4f2c-9a4a-0a6a9c7f1d22',
    schemaVersion: 1,
    eventType: 'content.withdrawn',
    aggregateId: 'fbbf8b73-151f-4931-817c-f5a10a9f31ec',
    aggregateVersion: 4,
    occurredAt: '2026-09-15T10:05:00.000Z',
    correlationId: '80696510-55ce-4b83-988b-d271021b9813',
    payload: { status: 'withdrawn' },
  },
];

/** Byte ceiling from DECISIONS D08; the relay rejects anything larger. */
export const MAX_EVENT_BYTES = 64 * 1024;

export const CORRELATION_ID_MAX = LIMITS.correlationId;
