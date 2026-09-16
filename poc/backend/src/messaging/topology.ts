/**
 * JetStream topology bootstrap (M3-01). Creates the CONTENT stream, the
 * quarantine DLQ and the two durable pull consumers idempotently. An existing
 * resource with a different configuration is refused by name — never silently
 * overwritten — because changing max_age or retention can drop messages.
 */
import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  type JetStreamManager,
} from '@nats-io/jetstream';
import { nanos } from '@nats-io/transport-node';
import {
  NATS_DURABLES,
  NATS_QUARANTINE_STREAM,
  NATS_QUARANTINE_SUBJECT,
  NATS_STREAM,
  NATS_SUBJECT,
} from '../contracts/events.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 7 * DAY_MS;
const DEFAULT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_MSGS = 1_000_000;
const DEFAULT_MAX_MSG_SIZE = 65_536;
/**
 * Redelivery deadline for an unacknowledged message. Pinned rather than left to
 * the server default because the M4 worker's `working()` heartbeat interval is
 * derived from it: a shorter ack_wait would redeliver an event that is still
 * being indexed.
 */
export const CONSUMER_ACK_WAIT_MS = 30_000;

export type TopologyNames = {
  stream: string;
  subject: string;
  quarantineStream: string;
  quarantineSubject: string;
  durables: readonly string[];
};

export type TopologyLimits = {
  maxAgeMs?: number;
  maxBytes?: number;
  maxMsgs?: number;
  maxMsgSize?: number;
  duplicateWindowMs?: number;
};

export class TopologyMismatchError extends Error {
  constructor(readonly resource: string, readonly fields: string[]) {
    super(`JetStream ${resource} configuration differs from the plan: ${fields.join(', ')}`);
    this.name = 'TopologyMismatchError';
  }
}

export function topologyNames(stream = NATS_STREAM, subject = NATS_SUBJECT): TopologyNames {
  const custom = stream !== NATS_STREAM || subject !== NATS_SUBJECT;
  return {
    stream,
    subject,
    quarantineStream: custom ? `${stream}_DLQ` : NATS_QUARANTINE_STREAM,
    quarantineSubject: custom ? `${subject}.quarantine` : NATS_QUARANTINE_SUBJECT,
    durables: custom ? NATS_DURABLES.map(name => `${stream}-${name}`) : [...NATS_DURABLES],
  };
}

function contentStreamConfig(names: TopologyNames, limits: TopologyLimits = {}) {
  return {
    name: names.stream,
    subjects: [names.subject],
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    num_replicas: 1,
    max_age: nanos(limits.maxAgeMs ?? DEFAULT_MAX_AGE_MS),
    max_bytes: limits.maxBytes ?? DEFAULT_MAX_BYTES,
    max_msgs: limits.maxMsgs ?? DEFAULT_MAX_MSGS,
    max_msg_size: limits.maxMsgSize ?? DEFAULT_MAX_MSG_SIZE,
    discard: DiscardPolicy.New,
    duplicate_window: nanos(limits.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS),
  };
}

function quarantineStreamConfig(names: TopologyNames) {
  return {
    name: names.quarantineStream,
    subjects: [names.quarantineSubject],
    storage: StorageType.File,
    retention: RetentionPolicy.Limits,
    num_replicas: 1,
    max_age: nanos(DEFAULT_MAX_AGE_MS),
    max_bytes: DEFAULT_MAX_BYTES,
    max_msgs: DEFAULT_MAX_MSGS,
    max_msg_size: DEFAULT_MAX_MSG_SIZE,
    discard: DiscardPolicy.New,
  };
}

type StreamExpected = {
  subjects: string[];
  storage: string;
  retention: string;
  num_replicas: number;
  max_age: number;
  max_bytes: number;
  max_msgs: number;
  max_msg_size: number;
  discard: string;
  duplicate_window?: number;
};

function compareStream(
  resource: string,
  expected: StreamExpected,
  actual: {
    config: {
      subjects?: string[];
      storage?: string;
      retention?: string;
      num_replicas?: number;
      max_age?: number;
      max_bytes?: number;
      max_msgs?: number;
      max_msg_size?: number;
      discard?: string;
      duplicate_window?: number;
    };
  },
  options: { checkDuplicateWindow?: boolean } = {},
): void {
  const fields: string[] = [];
  const cfg = actual.config;
  const sameSubjects =
    Array.isArray(cfg.subjects)
    && cfg.subjects.length === expected.subjects.length
    && expected.subjects.every((subject, index) => cfg.subjects![index] === subject);
  if (!sameSubjects) fields.push('subjects');
  if (cfg.storage !== expected.storage) fields.push('storage');
  if (cfg.retention !== expected.retention) fields.push('retention');
  if (cfg.num_replicas !== expected.num_replicas) fields.push('num_replicas');
  if (cfg.max_age !== expected.max_age) fields.push('max_age');
  if (cfg.max_bytes !== expected.max_bytes) fields.push('max_bytes');
  if (cfg.max_msgs !== expected.max_msgs) fields.push('max_msgs');
  if (cfg.max_msg_size !== expected.max_msg_size) fields.push('max_msg_size');
  if (cfg.discard !== expected.discard) fields.push('discard');
  if (
    options.checkDuplicateWindow !== false
    && expected.duplicate_window !== undefined
    && cfg.duplicate_window !== expected.duplicate_window
  ) {
    fields.push('duplicate_window');
  }
  if (fields.length) throw new TopologyMismatchError(resource, fields);
}

function compareConsumer(
  resource: string,
  expected: { filter_subject: string; ack_policy: string; deliver_policy: string; durable_name: string },
  actual: {
    config: {
      filter_subject?: string;
      ack_policy?: string;
      deliver_policy?: string;
      durable_name?: string;
    };
  },
): void {
  const fields: string[] = [];
  const cfg = actual.config;
  if (cfg.filter_subject !== expected.filter_subject) fields.push('filter_subject');
  if (cfg.ack_policy !== expected.ack_policy) fields.push('ack_policy');
  if (cfg.deliver_policy !== expected.deliver_policy) fields.push('deliver_policy');
  if (cfg.durable_name !== expected.durable_name) fields.push('durable_name');
  if (fields.length) throw new TopologyMismatchError(resource, fields);
}

/** Idempotent create-or-verify for the CONTENT stream, DLQ and durables. */
export async function ensureTopology(
  jsm: JetStreamManager,
  names: TopologyNames = topologyNames(),
  limits: TopologyLimits = {},
): Promise<void> {
  const contentExpected = contentStreamConfig(names, limits);
  try {
    const info = await jsm.streams.info(names.stream);
    compareStream(`stream ${names.stream}`, contentExpected, info);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await jsm.streams.add(contentExpected);
  }

  const quarantineExpected = quarantineStreamConfig(names);
  try {
    const info = await jsm.streams.info(names.quarantineStream);
    compareStream(`stream ${names.quarantineStream}`, quarantineExpected, info, { checkDuplicateWindow: false });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await jsm.streams.add(quarantineExpected);
  }

  for (const durable of names.durables) {
    const consumerExpected = {
      durable_name: durable,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: names.subject,
      ack_wait: nanos(CONSUMER_ACK_WAIT_MS),
    };
    try {
      const info = await jsm.consumers.info(names.stream, durable);
      compareConsumer(`consumer ${durable}`, consumerExpected, info);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await jsm.consumers.add(names.stream, consumerExpected);
    }
  }
}

/** Best-effort teardown for isolated test topologies. */
export async function destroyTopology(jsm: JetStreamManager, names: TopologyNames): Promise<void> {
  try { await jsm.streams.delete(names.stream); } catch { /* absent is fine */ }
  try { await jsm.streams.delete(names.quarantineStream); } catch { /* absent is fine */ }
}

function isNotFound(error: unknown): boolean {
  const code = (error as { api_error?: { err_code?: number }; code?: number })?.api_error?.err_code
    ?? (error as { code?: number })?.code;
  // 10059 stream not found, 10014 consumer not found
  return code === 10059 || code === 10014
    || (typeof (error as { message?: string })?.message === 'string'
      && /not found/i.test((error as { message: string }).message));
}
