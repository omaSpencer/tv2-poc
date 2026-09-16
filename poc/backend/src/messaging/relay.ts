/**
 * Outbox → JetStream relay (M3-03 / M3-04).
 *
 * One instance, FEATURE_OUTBOX_RELAY=on only. Reads pending rows in order,
 * publishes with msgID=eventId, and marks delivered_at only after PubAck.
 * Transient broker failures retry with D08 backoff; an invalid envelope halts.
 */
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pino, type Logger } from 'pino';
import { contentEventV1Schema, MAX_EVENT_BYTES } from '../contracts/events.js';
import { DatabaseService } from '../database.js';
import { envelopeFromRow, OutboxRepository } from '../outbox/outbox.repository.js';
import { OutboxWake } from '../outbox/outbox.wake.js';
import { classifyBrokerError, JetStreamAdapter } from './jetstream.adapter.js';
import { RelayState } from './relay.state.js';
import { TopologyMismatchError } from './topology.js';

/** Optional hooks used by integration tests to force interruption points. */
export type RelayTestHooks = {
  afterPublishAck?: (eventId: string) => Promise<void> | void;
  beforePublish?: (eventId: string) => void | Promise<void>;
  onCycle?: (info: { pending: number }) => void;
};

export const RELAY_TEST_HOOKS = 'RELAY_TEST_HOOKS';

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16_000, 30_000] as const;
const SHUTDOWN_GRACE_MS = 5000;
/** After the grace period the broker is aborted; the loop gets this long to unwind. */
const ABORT_SETTLE_MS = 500;

/**
 * Races `work` against a deadline and always clears the timer, so a fast stop
 * never leaves a multi-second timer holding the event loop open.
 * Resolves true when `work` won.
 */
async function raceDeadline(work: Promise<void>, ms: number): Promise<void> {
  if (ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>(resolve => { timer = setTimeout(resolve, ms); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class RelayHaltError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RelayHaltError';
  }
}

@Injectable()
export class OutboxRelay implements OnModuleInit, OnApplicationShutdown {
  private readonly log: Logger;
  private running = false;
  private loop: Promise<void> | null = null;
  /** A loop that outlived its shutdown grace period and is still unwinding. */
  private orphanedLoop: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private attempt = 0;

  private hooks: RelayTestHooks;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(JetStreamAdapter) private readonly broker: JetStreamAdapter,
    @Inject(OutboxWake) private readonly wake: OutboxWake,
    @Inject(RelayState) readonly status: RelayState,
    @Optional() @Inject(RELAY_TEST_HOOKS) hooks: RelayTestHooks | null = null,
  ) {
    this.log = pino({ level: this.config.getOrThrow<string>('LOG_LEVEL') });
    this.hooks = hooks ?? {};
  }

  /** Test assemblies install interruption points before `start()`. */
  setHooks(hooks: RelayTestHooks): void {
    this.hooks = hooks;
  }

  onModuleInit(): void {
    if (this.config.getOrThrow<string>('FEATURE_OUTBOX_RELAY') !== 'on') {
      this.status.setEnabled(false);
      return;
    }
    this.status.setEnabled(true);
    // Tests set RELAY_AUTO_START=off so hooks/limits can be installed first.
    if (process.env.RELAY_AUTO_START === 'off') return;
    this.start();
  }

  start(): void {
    if (this.loop) return;
    if (this.stopping) {
      // A prior stop is still draining; ignore a duplicate start until it finishes.
      return;
    }
    if (this.orphanedLoop) {
      // A previous cycle outlived its grace period and is still unwinding.
      // Starting a second loop beside it would double-publish.
      this.log.warn({ event: 'relay_start_refused', reason: 'previous_loop_still_running' });
      return;
    }
    const enabled = this.config.getOrThrow<string>('FEATURE_OUTBOX_RELAY') === 'on'
      || process.env.FEATURE_OUTBOX_RELAY === 'on';
    if (!enabled) return;
    this.status.setEnabled(true);
    this.running = true;
    this.stopping = null;
    this.wake.resume();
    this.log.info({ event: 'relay_started' });
    this.loop = this.runLoop();
  }

  /** Soft-stop the loop without waiting for the in-flight publish/mark pair. */
  requestStop(): void {
    this.running = false;
    this.wake.interrupt();
  }

  /** True while a loop abandoned at the grace deadline is still unwinding. */
  get hasOrphanedLoop(): boolean {
    return this.orphanedLoop !== null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop(SHUTDOWN_GRACE_MS);
  }

  /** Test / demo helper: stop the loop with a bounded grace period. */
  async stop(graceMs = SHUTDOWN_GRACE_MS): Promise<void> {
    if (this.stopping) return this.stopping;
    const wasEnabled = this.status.enabled || this.running || this.loop !== null;
    if (!this.running && !this.loop) {
      await this.broker.close();
      this.status.setState('off');
      if (wasEnabled) this.log.info({ event: 'relay_stopped' });
      return;
    }
    this.stopping = (async () => {
      const deadline = Date.now() + Math.max(0, graceMs);
      this.running = false;
      this.wake.interrupt();

      const loop = this.loop;
      this.loop = null;
      let settled = loop === null;
      const drained = loop === null
        ? Promise.resolve()
        : loop.then(() => { settled = true; }, () => { settled = true; });

      // The deadline covers the whole stop, not only the first wait.
      await raceDeadline(drained, Math.max(0, deadline - Date.now()));

      if (!settled) {
        // Grace expired with work still in flight: abort the broker so the
        // pending publish rejects instead of waiting out its own timeout.
        this.log.warn({ event: 'relay_stop_timeout', graceMs });
        this.status.markError('stop_timeout');
        await this.broker.abort();
        await raceDeadline(drained, ABORT_SETTLE_MS);
      }

      if (settled) {
        this.orphanedLoop = null;
      } else {
        // Still unwinding. Keep a handle so `start()` refuses a second loop.
        const orphan = drained.finally(() => {
          if (this.orphanedLoop === orphan) this.orphanedLoop = null;
        });
        this.orphanedLoop = orphan;
      }

      await this.broker.close();
      this.status.setState('off');
      this.log.info({ event: 'relay_stopped' });
      this.stopping = null;
    })();
    return this.stopping;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      if (this.status.state === 'halted') {
        // A halted relay makes no progress until it is restarted; a new CMS
        // event must not spin this branch, so only shutdown ends the wait.
        await this.wake.backoff(this.pollMs());
        continue;
      }
      let hadWork = false;
      try {
        hadWork = await this.cycle();
        this.attempt = 0;
        if (hadWork) this.status.setState('idle');
      } catch (error) {
        if (error instanceof RelayHaltError) {
          this.status.setState('halted');
          this.status.markError(error.code);
          this.log.error({ event: 'relay_halted', code: error.code });
          continue;
        }
        if (error instanceof TopologyMismatchError) {
          this.status.setState('halted');
          this.status.markError('topology_mismatch');
          this.log.error({
            event: 'relay_halted',
            code: 'topology_mismatch',
            fields: error.fields,
          });
          continue;
        }
        this.status.setState('retrying');
        this.status.markError(classifyBrokerError(error));
        const delayMs = this.nextDelayMs();
        this.log.warn({ event: 'relay_retry', attempt: this.attempt, delayMs });
        // Backoff after a broker failure is mandatory: CMS wake signals must
        // not shorten it, or a busy CMS would hammer a failing broker (R06).
        await this.wake.backoff(delayMs);
        continue;
      }
      if (!this.running) break;
      if (!hadWork) {
        this.status.setState('idle');
        await this.wake.wait(this.pollMs());
      }
    }
  }

  private async cycle(): Promise<boolean> {
    const batch = this.config.getOrThrow<number>('NATS_RELAY_BATCH');
    const rows = await this.outbox.pending(this.database.db, batch);
    this.hooks.onCycle?.({ pending: rows.length });
    if (rows.length === 0) return false;

    for (const row of rows) {
      if (!this.running) return true;
      const envelope = envelopeFromRow(row);
      const validated = contentEventV1Schema.safeParse(envelope);
      if (!validated.success) {
        throw new RelayHaltError('invalid_envelope', 'Outbox envelope failed v1 schema validation.');
      }
      const payload = Buffer.from(JSON.stringify(validated.data), 'utf8');
      if (payload.byteLength > MAX_EVENT_BYTES) {
        throw new RelayHaltError('envelope_too_large', 'Outbox envelope exceeds MAX_EVENT_BYTES.');
      }

      this.status.setState('publishing');
      await this.hooks.beforePublish?.(row.eventId);
      let published;
      try {
        published = await this.broker.publish(payload, row.eventId);
      } catch (error) {
        const kind = classifyBrokerError(error);
        if (kind === 'fatal') throw error;
        throw error;
      }

      this.log.info({
        event: 'relay_published',
        eventId: row.eventId,
        correlationId: row.correlationId,
        streamSeq: published.streamSeq,
        duplicate: published.duplicate,
      });

      await this.hooks.afterPublishAck?.(row.eventId);
      if (!this.running) return true;

      const deliveredAt = new Date();
      await this.outbox.markDelivered(this.database.db, row.eventId, deliveredAt, published.streamSeq);
      this.status.markDelivered(deliveredAt);
      this.log.info({
        event: 'relay_delivered',
        eventId: row.eventId,
        correlationId: row.correlationId,
      });
    }
    return true;
  }

  private pollMs(): number {
    return this.config.getOrThrow<number>('NATS_RELAY_POLL_MS');
  }

  private nextDelayMs(): number {
    const index = Math.min(this.attempt, RETRY_DELAYS_MS.length - 1);
    this.attempt += 1;
    const base = RETRY_DELAYS_MS[index]!;
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }
}
