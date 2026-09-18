/**
 * JetStream adapter (M3-02). Owns the NATS connection, topology bootstrap,
 * timed publish with msgID and a bounded drain on shutdown. Connection loss is
 * never fatal to the process: the relay retries with D08 backoff.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  jetstream, jetstreamManager,
  type Consumer, type ConsumerInfo, type JetStreamClient, type JetStreamManager, type PubAck,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import {
  NATS_STREAM, NATS_SUBJECT,
} from '../contracts/events.js';
import {
  ensureTopology, topologyNames, TopologyMismatchError, type TopologyLimits, type TopologyNames,
} from './topology.js';

export type PublishResult = {
  stream: string;
  streamSeq: number;
  duplicate: boolean;
};

export type BrokerSnapshot = {
  connected: boolean;
  streamPresent: boolean | null;
  consumers: Array<{
    name: string;
    pending: number;
    ackPending: number;
    ackFloorStreamSequence: number;
    oldestUnfinishedAt: string | null;
  }> | null;
  quarantinePending: number | null;
};

export type ConsumerProgress = {
  ackFloorStreamSequence: number;
  pending: number;
  ackPending: number;
};

export type StoredMessage = { subject: string; sequence: number; data: Uint8Array };
export type StreamBounds = { firstSequence: number; lastSequence: number; messages: number };

export const JETSTREAM_TOPOLOGY_LIMITS = 'JETSTREAM_TOPOLOGY_LIMITS';

@Injectable()
export class JetStreamAdapter {
  private connection: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private topologyReady = false;
  private topologyError: TopologyMismatchError | null = null;
  private connecting: Promise<void> | null = null;
  readonly names: TopologyNames;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Optional() @Inject(JETSTREAM_TOPOLOGY_LIMITS) private limits: TopologyLimits | null = null,
  ) {
    this.names = topologyNames(
      this.config.get<string>('NATS_STREAM') ?? NATS_STREAM,
      this.config.get<string>('NATS_SUBJECT') ?? NATS_SUBJECT,
    );
  }

  /** Test assemblies install capacity limits before the first connect. */
  setTopologyLimits(limits: TopologyLimits | null): void {
    this.limits = limits;
  }

  get url(): string {
    return this.config.getOrThrow<string>('NATS_URL');
  }

  get publishAckTimeoutMs(): number {
    return this.config.getOrThrow<number>('NATS_PUBLISH_ACK_TIMEOUT_MS');
  }

  get lastTopologyError(): TopologyMismatchError | null {
    return this.topologyError;
  }

  get isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  get hasTopology(): boolean {
    return this.topologyReady;
  }

  get serverVersion(): string | null {
    return this.connection?.info?.version ?? null;
  }

  async ensureConnected(): Promise<void> {
    if (this.topologyError) throw this.topologyError;
    if (this.isConnected && this.topologyReady && this.js && this.jsm) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectOnce().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectOnce(): Promise<void> {
    if (this.connection && !this.connection.isClosed()) {
      await this.connection.close().catch(() => undefined);
    }
    this.connection = null;
    this.js = null;
    this.jsm = null;
    this.topologyReady = false;

    const nc = await connect({
      servers: this.url,
      name: 'indaplay-poc-relay',
      reconnect: false,
      maxReconnectAttempts: 0,
      timeout: 1500,
      pedantic: false,
    });
    this.connection = nc;
    this.jsm = await jetstreamManager(nc);
    this.js = jetstream(nc, { timeout: this.publishAckTimeoutMs });
    try {
      await ensureTopology(this.jsm, this.names, this.limits ?? undefined);
      this.topologyReady = true;
      this.topologyError = null;
    } catch (error) {
      if (error instanceof TopologyMismatchError) {
        this.topologyError = error;
      }
      await nc.close().catch(() => undefined);
      this.connection = null;
      this.js = null;
      this.jsm = null;
      this.topologyReady = false;
      throw error;
    }
  }

  async publish(payload: Uint8Array, msgID: string): Promise<PublishResult> {
    return this.publishTo(this.names.subject, payload, msgID);
  }

  /**
   * Publish to a named subject on this topology. The quarantine path needs it
   * (M4-05); the msgID makes a repeat after a lost PubAck deduplicate rather
   * than write a second record.
   */
  async publishTo(subject: string, payload: Uint8Array, msgID: string): Promise<PublishResult> {
    await this.ensureConnected();
    if (!this.js) throw new Error('JetStream client is not connected.');
    const ack: PubAck = await this.js.publish(subject, payload, {
      msgID,
      timeout: this.publishAckTimeoutMs,
    });
    return {
      stream: ack.stream,
      streamSeq: ack.seq,
      duplicate: ack.duplicate === true,
    };
  }

  /** Durable pull consumer handle for a search projection worker (M4-04). */
  async consumer(durable: string): Promise<Consumer> {
    await this.ensureConnected();
    if (!this.js) throw new Error('JetStream client is not connected.');
    return this.js.consumers.get(this.names.stream, durable);
  }

  /**
   * Live consumer configuration. The worker verifies ack_policy, deliver_policy,
   * filter subject and ack_wait against the M3 contract before it consumes, so a
   * consumer that was reconfigured elsewhere cannot silently change the ACK
   * semantics M4 depends on.
   */
  async consumerInfo(durable: string): Promise<ConsumerInfo> {
    await this.ensureConnected();
    if (!this.jsm) throw new Error('JetStream manager is not connected.');
    return this.jsm.consumers.info(this.names.stream, durable);
  }

  async streamSequence(): Promise<number> {
    await this.ensureConnected();
    if (!this.jsm) throw new Error('JetStream manager is not connected.');
    return (await this.jsm.streams.info(this.names.stream)).state.last_seq;
  }

  async consumerProgress(durable: string): Promise<ConsumerProgress> {
    const info = await this.consumerInfo(durable);
    return {
      ackFloorStreamSequence: info.ack_floor.stream_seq,
      pending: info.num_pending,
      ackPending: info.num_ack_pending,
    };
  }

  /** Exact retention check for the finite S0+1…S1 catch-up interval. */
  async hasSequenceRange(first: number, last: number): Promise<boolean> {
    if (last < first) return true;
    await this.ensureConnected();
    if (!this.jsm) throw new Error('JetStream manager is not connected.');
    const info = await this.jsm.streams.info(this.names.stream);
    if (info.state.messages === 0 || info.state.first_seq > first || info.state.last_seq < last) return false;
    for (let sequence = first; sequence <= last; sequence += 1) {
      const message = await this.jsm.streams.getMessage(this.names.stream, { seq: sequence });
      if (message === null) return false;
    }
    return true;
  }

  async storedMessage(stream: string, sequence: number): Promise<StoredMessage | null> {
    await this.ensureConnected();
    if (!this.jsm) throw new Error('JetStream manager is not connected.');
    const message = await this.jsm.streams.getMessage(stream, { seq: sequence });
    return message === null ? null : { subject: message.subject, sequence: message.seq, data: message.data };
  }

  async streamBounds(stream: string): Promise<StreamBounds> {
    await this.ensureConnected();
    if (!this.jsm) throw new Error('JetStream manager is not connected.');
    const info = await this.jsm.streams.info(stream);
    return {
      firstSequence: info.state.first_seq,
      lastSequence: info.state.last_seq,
      messages: info.state.messages,
    };
  }

  async snapshot(): Promise<BrokerSnapshot> {
    try {
      if (!this.isConnected || !this.jsm) {
        return { connected: false, streamPresent: null, consumers: null, quarantinePending: null };
      }
      let streamPresent = false;
      try {
        await this.jsm.streams.info(this.names.stream);
        streamPresent = true;
      } catch {
        streamPresent = false;
      }
      if (!streamPresent) {
        return { connected: true, streamPresent: false, consumers: null, quarantinePending: null };
      }
      const consumers: NonNullable<BrokerSnapshot['consumers']> = [];
      for (const name of this.names.durables) {
        try {
          const info = await this.jsm.consumers.info(this.names.stream, name);
          const firstUnfinished = info.ack_floor.stream_seq + 1;
          const message = info.num_pending + info.num_ack_pending > 0
            ? await this.jsm.streams.getMessage(this.names.stream, { seq: firstUnfinished }).catch(() => null)
            : null;
          consumers.push({
            name,
            pending: info.num_pending,
            ackPending: info.num_ack_pending,
            ackFloorStreamSequence: info.ack_floor.stream_seq,
            oldestUnfinishedAt: message?.time.toISOString() ?? null,
          });
        } catch {
          return { connected: true, streamPresent: true, consumers: null, quarantinePending: null };
        }
      }
      let quarantinePending: number | null = null;
      try {
        const q = await this.jsm.streams.info(this.names.quarantineStream);
        quarantinePending = q.state.messages;
      } catch {
        quarantinePending = null;
      }
      return { connected: true, streamPresent: true, consumers, quarantinePending };
    } catch {
      return { connected: false, streamPresent: null, consumers: null, quarantinePending: null };
    }
  }

  private isClosed(): boolean {
    return this.connection === null || this.connection.isClosed();
  }

  /**
   * Immediate, non-draining close. Used when a shutdown grace period expires:
   * closing the connection makes an in-flight publish reject instead of
   * hanging on its own ACK timeout, so `stop(graceMs)` can be a real bound.
   */
  async abort(closeTimeoutMs = 500): Promise<void> {
    const nc = this.connection;
    this.connection = null;
    this.js = null;
    this.jsm = null;
    this.topologyReady = false;
    this.connecting = null;
    if (!nc || nc.isClosed()) return;
    try {
      await Promise.race([
        nc.close(),
        new Promise<void>(resolve => setTimeout(resolve, closeTimeoutMs)),
      ]);
    } catch { /* aborting best-effort */ }
  }

  async close(drainMs = 2000): Promise<void> {
    const nc = this.connection;
    this.connection = null;
    this.js = null;
    this.jsm = null;
    this.topologyReady = false;
    if (!nc || nc.isClosed()) return;
    try {
      await Promise.race([
        nc.drain(),
        new Promise<void>(resolve => setTimeout(resolve, drainMs)),
      ]);
    } catch { /* closing best-effort */ }
    try {
      if (!nc.isClosed()) await nc.close();
    } catch { /* already closed */ }
  }
}

/** Classify a publish/connect failure for relay retry vs halt. */
export function classifyBrokerError(error: unknown): 'transient' | 'capacity' | 'fatal' {
  if (error instanceof TopologyMismatchError) return 'fatal';
  const message = error instanceof Error ? error.message : String(error);
  if (/maximum messages|max.?msgs|maximum bytes|max.?bytes|resource limits exceeded/i.test(message)) {
    return 'capacity';
  }
  const code = (error as { code?: string | number; api_error?: { err_code?: number } })?.code
    ?? (error as { api_error?: { err_code?: number } })?.api_error?.err_code;
  if (code === 'TIMEOUT' || code === 503) return 'transient';
  if (/timeout|connection|disconnect|no responders|503|temporarily/i.test(message)) return 'transient';
  return 'transient';
}
