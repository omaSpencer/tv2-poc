/**
 * NATS helpers for M3 integration tests. Supports Compose-started and external
 * brokers via NATS_URL. Every case uses an isolated stream/subject pair and
 * tears it down afterwards so the demo CONTENT stream stays untouched.
 */
import { randomUUID } from 'node:crypto';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { jetstream, jetstreamManager, type JetStreamManager } from '@nats-io/jetstream';
import {
  destroyTopology, ensureTopology, topologyNames, type TopologyLimits, type TopologyNames,
} from '../../src/messaging/topology.js';
import { contentEventV1Schema, type ContentEventV1 } from '../../src/contracts/events.js';

export function natsUrl(): string {
  const url = process.env.NATS_URL ?? process.env.TEST_NATS_URL;
  if (!url) {
    throw new Error('NATS_URL or TEST_NATS_URL is required for M3 JetStream tests.');
  }
  return url;
}

export function hasNats(): boolean {
  return Boolean(process.env.NATS_URL ?? process.env.TEST_NATS_URL);
}

export type IsolatedTopology = TopologyNames & { runId: string };

export function isolatedTopology(prefix = 'M3'): IsolatedTopology {
  const runId = `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  // Stream names must be alphanumeric / underscore / dash.
  const stream = `T_${runId}`;
  const subject = `poc.test.${runId}.changed.v1`;
  return { runId, ...topologyNames(stream, subject) };
}

export async function withNats<T>(
  work: (ctx: { nc: NatsConnection; jsm: JetStreamManager; names: IsolatedTopology }) => Promise<T>,
  limits?: TopologyLimits,
): Promise<T> {
  const names = isolatedTopology();
  const nc = await connect({ servers: natsUrl(), name: `m3-test-${names.runId}` });
  const jsm = await jetstreamManager(nc);
  try {
    await ensureTopology(jsm, names, limits);
    return await work({ nc, jsm, names });
  } finally {
    await destroyTopology(jsm, names).catch(() => undefined);
    await nc.drain().catch(() => undefined);
    await nc.close().catch(() => undefined);
  }
}

export async function readStreamMessages(
  nc: NatsConnection,
  names: TopologyNames,
  count: number,
  timeoutMs = 5000,
): Promise<ContentEventV1[]> {
  const js = jetstream(nc);
  const consumer = await js.consumers.get(names.stream, names.durables[0]!);
  const messages: ContentEventV1[] = [];
  const deadline = Date.now() + timeoutMs;
  while (messages.length < count && Date.now() < deadline) {
    const msg = await consumer.next({ expires: Math.min(1000, deadline - Date.now()) });
    if (!msg) continue;
    const parsed = contentEventV1Schema.parse(JSON.parse(new TextDecoder().decode(msg.data)));
    messages.push(parsed);
    // M3 never ACKs for real consumers; tests may ACK ephemeral progress.
    msg.ack();
  }
  return messages;
}

export async function streamMessageCount(jsm: JetStreamManager, stream: string): Promise<number> {
  const info = await jsm.streams.info(stream);
  return info.state.messages;
}

export async function waitFor(
  description: string,
  probe: () => Promise<boolean>,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
      last = 'condition false';
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out waiting for ${description} (${last})`);
}
