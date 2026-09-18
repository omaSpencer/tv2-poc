/**
 * Search projection worker (M4-04 / M4-05).
 *
 * Two instances of this class run side by side, one per index. They share no
 * message, task UID, retry counter or state, so a halted A says nothing about B
 * and a stalled B does not hold A back.
 *
 * The invariant the whole file exists to protect: **a message is acknowledged
 * only after the Meilisearch task it produced has reached `succeeded`, or after
 * it has been durably quarantined.** Everything else follows from that:
 *
 * - exactly one message is in flight, so one index's ordering is never
 *   reordered by a later event overtaking a failing one;
 * - a long task is kept alive with `working()` rather than being allowed to
 *   redeliver;
 * - a lost poll response re-polls the *same* task UID instead of submitting a
 *   second write;
 * - a crash between a successful index write and the ACK replays the operation,
 *   which is safe because upsert and delete are both idempotent.
 */
import type { Logger } from 'pino';
import type { JsMsg } from '@nats-io/jetstream';
import type { Consumer } from '@nats-io/jetstream';
import { raceDeadline } from '../common/deadline.js';
import {
  D08_RETRY_DELAYS_MS, D08_RETRY_JITTER, peekRetryDelayMs, retryDelayMs,
} from '../common/retry.js';
import { contentEventV1Schema, type ContentEventV1 } from '../contracts/events.js';
import type { SearchIndexAlias } from '../contracts/search.js';
import type { DatabaseService } from '../database.js';
import type { ContentRepository } from '../content/content.repository.js';
import { OutboxWake } from '../outbox/outbox.wake.js';
import { CONSUMER_ACK_WAIT_MS, type TopologyNames } from '../messaging/topology.js';
import type { JetStreamAdapter } from '../messaging/jetstream.adapter.js';
import { bootstrapIndex } from './index-bootstrap.js';
import {
  classifyMeiliError, IndexConfigMismatchError, isPermanentTaskError, meiliErrorCode,
  MeiliTaskFailedError, MeiliTaskTimeoutError, type MeiliIndexAdapter,
} from './meili.adapter.js';
import { projectionFor } from './projection.js';
import { buildQuarantine, quarantineMsgId, recoverEventId } from './quarantine.js';
import type { SearchIndexState } from './worker.state.js';
import type { ReindexControlRepository } from './reindex/control.repository.js';
import { componentLogger, createAppLogger } from '../observability/logger.js';

/** D08 backoff ladder. The last value repeats for every further attempt. */
export const SEARCH_RETRY_DELAYS_MS = D08_RETRY_DELAYS_MS;
export const SEARCH_RETRY_JITTER = D08_RETRY_JITTER;
export { retryDelayMs };

/** How long a halted worker waits before re-reading its own state. */
const HALT_POLL_MS = 1000;
/** JetStream requires at least one second for a pull expiry. */
const FETCH_EXPIRES_MS = 1000;
const SHUTDOWN_GRACE_MS = 5000;
const ABORT_SETTLE_MS = 500;

export class ConsumerContractError extends Error {
  constructor(readonly durable: string, readonly fields: string[]) {
    super(`Durable consumer ${durable} does not satisfy the M4 contract: ${fields.join(', ')}`);
    this.name = 'ConsumerContractError';
  }
}

export type SearchWorkerOptions = {
  /** Test assemblies shorten the ladder; production uses the D08 values. */
  retryDelaysMs?: readonly number[];
  workingMs?: number;
  logLevel?: string;
  logger?: Logger;
};

/** Interruption points for integration tests. Never installed in production. */
export type SearchWorkerHooks = {
  afterTaskSucceeded?: (eventId: string) => Promise<void> | void;
  beforeSubmit?: (eventId: string) => Promise<void> | void;
};

export class SearchProjectionWorker {
  private readonly log: Logger;
  /**
   * Per-worker instance of the corrected wake primitive (R06/R12): only
   * shutdown ends a backoff, a CMS event never does, and every wait clears its
   * own timer. A shared instance would let one worker's stop release the other.
   */
  private readonly wake = new OutboxWake();
  private readonly abortSignal = { aborted: false };
  private readonly retryDelays: readonly number[];
  private readonly workingMs: number;

  private running = false;
  private loop: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private orphanedLoop: Promise<void> | null = null;
  private consumerHandle: Consumer | null = null;
  private indexReady = false;
  private attempt = 0;
  private hooks: SearchWorkerHooks = {};

  /** Diagnostics for the T08 heartbeat assertion. */
  workingSignals = 0;

  constructor(
    readonly alias: SearchIndexAlias,
    readonly durable: string,
    private readonly adapter: MeiliIndexAdapter,
    readonly state: SearchIndexState,
    private readonly broker: JetStreamAdapter,
    private readonly names: TopologyNames,
    private readonly database: DatabaseService,
    private readonly repository: ContentRepository,
    options: SearchWorkerOptions = {},
    private readonly control: ReindexControlRepository | null = null,
  ) {
    this.log = componentLogger(
      options.logger ?? createAppLogger(options.logLevel ?? 'info'),
      `search-worker-${alias}`,
    );
    this.retryDelays = options.retryDelaysMs ?? SEARCH_RETRY_DELAYS_MS;
    this.workingMs = options.workingMs ?? 10_000;
    this.state.durable = durable;
  }

  setHooks(hooks: SearchWorkerHooks): void {
    this.hooks = hooks;
  }

  get isRunning(): boolean {
    return this.loop !== null;
  }

  get hasOrphanedLoop(): boolean {
    return this.orphanedLoop !== null;
  }

  start(): void {
    if (this.loop || this.stopping) return;
    if (this.orphanedLoop) {
      // A cycle abandoned at its grace deadline is still unwinding; a second
      // loop beside it would consume the same durable twice.
      this.log.warn({ event: 'search_worker_start_refused', index: this.alias, reason: 'previous_loop_still_running' });
      return;
    }
    this.running = true;
    this.abortSignal.aborted = false;
    this.attempt = 0;
    this.consumerHandle = null;
    this.indexReady = false;
    this.state.bootstrapped = false;
    this.wake.resume();
    this.state.state = 'bootstrapping';
    this.state.lastErrorCode = null;
    this.log.info({ event: 'search_worker_started', index: this.alias, durable: this.durable });
    this.loop = this.runLoop();
  }

  /**
   * Soft-stop: the loop finishes what it can and asks for nothing more. Unlike
   * `stop()` it does not wait, which is what makes "interrupted between task
   * success and ACK" reproducible.
   */
  requestStop(): void {
    this.running = false;
    this.abortSignal.aborted = true;
    this.wake.interrupt();
  }

  async stop(graceMs = SHUTDOWN_GRACE_MS): Promise<void> {
    if (this.stopping) return this.stopping;
    if (!this.running && !this.loop) {
      this.state.setState('off');
      return;
    }
    this.stopping = (async () => {
      const deadline = Date.now() + Math.max(0, graceMs);
      this.running = false;
      this.abortSignal.aborted = true;
      this.wake.interrupt();

      const loop = this.loop;
      this.loop = null;
      let settled = loop === null;
      const drained = loop === null
        ? Promise.resolve()
        : loop.then(() => { settled = true; }, () => { settled = true; });

      await raceDeadline(drained, Math.max(0, deadline - Date.now()));
      if (!settled) {
        // The grace period is a real upper bound: the in-flight operation is
        // abandoned without an ACK and the message will be redelivered.
        this.log.warn({ event: 'search_worker_stop_timeout', index: this.alias, graceMs });
        this.state.markError('stop_timeout');
        await raceDeadline(drained, ABORT_SETTLE_MS);
      }
      this.orphanedLoop = settled
        ? null
        : (() => {
          const orphan = drained.finally(() => {
            if (this.orphanedLoop === orphan) this.orphanedLoop = null;
          });
          return orphan;
        })();

      this.consumerHandle = null;
      this.indexReady = false;
      this.state.bootstrapped = false;
      this.state.setState('off');
      this.state.setInFlight(null);
      this.state.setTask(null);
      await this.control?.observeWorker(this.alias, null).catch(() => undefined);
      this.log.info({ event: 'search_worker_stopped', index: this.alias });
      this.stopping = null;
    })();
    return this.stopping;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        if (await this.pauseWhenRequested()) continue;
      } catch (error) {
        this.recordFailure(error, 'search_control_retry');
        await this.wake.backoff(this.nextDelayMs());
        continue;
      }
      if (this.isHalted()) {
        // Halted needs an operator, not a retry. Only shutdown ends this wait.
        await this.wake.backoff(HALT_POLL_MS);
        continue;
      }
      let message: JsMsg | null = null;
      try {
        await this.ensureReady();
        if (!this.running) break;
        message = await this.fetchOne();
        this.attempt = 0;
      } catch (error) {
        this.recordFailure(error, 'search_worker_retry');
        // recordFailure may have halted this instance; a backoff would be wrong.
        if (this.isHalted()) continue;
        await this.wake.backoff(this.nextDelayMs());
        continue;
      }
      if (message === null) {
        this.state.setState('idle');
        continue;
      }
      await this.handleMessage(message);
    }
  }

  /** Connection, verified consumer contract and a provisioned index. */
  /** Read through a method so narrowing cannot hide a state change made mid-loop. */
  private isHalted(): boolean {
    return this.state.state === 'halted';
  }

  private async ensureReady(): Promise<void> {
    if (this.consumerHandle === null || !this.broker.isConnected) {
      await this.verifyConsumerContract();
      this.consumerHandle = await this.broker.consumer(this.durable);
    }
    if (!this.indexReady) {
      this.state.setState('bootstrapping');
      const outcome = await bootstrapIndex(this.adapter);
      if (!this.running) return;
      this.indexReady = true;
      this.state.bootstrapped = true;
      this.state.setReachable(true);
      this.log.info({
        event: 'search_index_bootstrapped',
        index: this.alias,
        created: outcome.created,
        settingsApplied: outcome.settingsApplied,
      });
    }
    if (this.state.state === 'bootstrapping') this.state.setState('idle');
  }

  /**
   * The ACK semantics M4 relies on live in the consumer configuration, not in
   * this process. A consumer that was recreated with a different policy would
   * silently break the "ACK only after task success" guarantee, so it is
   * checked before the first message rather than inferred.
   */
  private async verifyConsumerContract(): Promise<void> {
    const info = await this.broker.consumerInfo(this.durable);
    const fields: string[] = [];
    if (info.config.ack_policy !== 'explicit') fields.push('ack_policy');
    if (info.config.deliver_policy !== 'all') fields.push('deliver_policy');
    if (info.config.filter_subject !== this.names.subject) fields.push('filter_subject');
    // Nanoseconds on the wire; the heartbeat interval must stay well inside it.
    const ackWaitMs = Number(info.config.ack_wait ?? 0) / 1_000_000;
    if (!Number.isFinite(ackWaitMs) || ackWaitMs < CONSUMER_ACK_WAIT_MS) fields.push('ack_wait');
    if (!Number.isFinite(this.workingMs) || this.workingMs <= 0 || this.workingMs * 3 > ackWaitMs) {
      fields.push('working_interval');
    }
    if (fields.length > 0) throw new ConsumerContractError(this.durable, fields);
  }

  private async fetchOne(): Promise<JsMsg | null> {
    if (this.consumerHandle === null) return null;
    try {
      return await this.consumerHandle.next({ expires: FETCH_EXPIRES_MS });
    } catch (error) {
      // A closed connection's handle cannot recover with the replacement connection.
      this.consumerHandle = null;
      throw error;
    }
  }

  private async handleMessage(message: JsMsg): Promise<void> {
    const heartbeat = setInterval(() => {
      try {
        message.working();
        this.workingSignals += 1;
      } catch { /* the delivery is already gone; the loop will notice */ }
    }, this.workingMs);
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(message.data));
      } catch {
        await this.quarantine(message, 'invalid_json', null);
        return;
      }
      const parsed = contentEventV1Schema.safeParse(raw);
      if (!parsed.success) {
        await this.quarantine(message, 'invalid_event_schema', recoverEventId(raw));
        return;
      }
      const event = parsed.data;
      this.state.setInFlight(event.eventId);
      await this.control?.observeWorker(this.alias, event.eventId);
      this.log.info({
        event: 'search_event_received',
        index: this.alias,
        eventId: event.eventId,
        correlationId: event.correlationId,
      });
      await this.project(message, event);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * One message, one index operation, retried in place until it succeeds, is
   * quarantined, or the worker halts or stops. No further message is requested
   * while this runs.
   */
  private async project(message: JsMsg, event: ContentEventV1): Promise<void> {
    let pendingTaskUid: number | null = null;
    this.attempt = 0;

    while (this.running) {
      try {
        if (!this.indexReady) await this.ensureReady();
        if (pendingTaskUid === null) {
          // Always the *current* database state: an old publish event replayed
          // after a withdrawal must converge on a delete.
          const row = await this.repository.findById(this.database.db, event.aggregateId);
          const decision = projectionFor(event.aggregateId, row);
          if (decision.operation === 'reject') {
            this.log.warn({
              event: 'search_projection_rejected',
              index: this.alias,
              eventId: event.eventId,
              fields: decision.fields,
            });
            await this.quarantine(message, 'projection_rejected', event.eventId);
            return;
          }
          this.state.setState('processing');
          await this.hooks.beforeSubmit?.(event.eventId);
          if (!this.running) return;
          pendingTaskUid = decision.operation === 'upsert'
            ? await this.adapter.submitUpsert(decision.document)
            : await this.adapter.submitDelete(decision.id);
          this.state.setTask(pendingTaskUid);
          this.log.info({
            event: 'search_task_submitted',
            index: this.alias,
            eventId: event.eventId,
            operation: decision.operation,
            taskUid: pendingTaskUid,
          });
        }

        const result = await this.adapter.awaitTask(pendingTaskUid, undefined, this.abortSignal);
        if (result.status === 'succeeded') {
          // Interruption point: a stop here leaves the index written and the
          // message unacknowledged, which is the redelivery case T07 exercises.
          await this.hooks.afterTaskSucceeded?.(event.eventId);
          if (!this.running) return;
          message.ack();
          this.state.markAcked();
          await this.control?.observeWorker(this.alias, null);
          this.state.setState('idle');
          this.attempt = 0;
          this.log.info({
            event: 'search_task_succeeded',
            index: this.alias,
            eventId: event.eventId,
            taskUid: result.uid,
          });
          return;
        }
        // Terminal but unsuccessful: this task UID is spent either way.
        pendingTaskUid = null;
        this.state.setTask(null);
        if (isPermanentTaskError(result.errorCode)) {
          await this.quarantine(message, 'projection_rejected', event.eventId);
          return;
        }
        throw new MeiliTaskFailedError(result.uid, result.errorCode);
      } catch (error) {
        // A poll that never reached a terminal state keeps its task UID: the
        // work may still be running, and resubmitting would duplicate it.
        // Keep an accepted UID across network/429/5xx poll failures. Terminal
        // failures already clear it above; failed submissions never assigned it.
        const kind = classifyMeiliError(error);
        if (kind === 'config' || error instanceof ConsumerContractError) {
          this.haltOn(error);
          return;
        }
        if (kind === 'client_error') {
          // A 4xx from a request we built: no retry can change the answer.
          pendingTaskUid = null;
          this.state.setTask(null);
          this.log.warn({
            event: 'search_projection_rejected',
            index: this.alias,
            eventId: event.eventId,
            code: meiliErrorCode(error),
          });
          await this.quarantine(message, 'projection_rejected', event.eventId);
          return;
        }
        if (kind === 'not_found') {
          this.indexReady = false;
          this.state.bootstrapped = false;
        }
        if (!this.running) return;
        this.recordFailure(error, 'search_worker_retry', event.eventId);
        await this.wake.backoff(this.nextDelayMs());
      }
    }
  }

  /**
   * The original message is acknowledged only after the quarantine record has a
   * PubAck. A failing DLQ therefore leaves the poisoned message pending rather
   * than dropping it silently.
   */
  private async quarantine(
    message: JsMsg,
    errorCode: 'invalid_json' | 'invalid_event_schema' | 'projection_rejected',
    originalEventId: string | null,
  ): Promise<void> {
    const streamSequence = message.info.streamSequence;
    const envelope = buildQuarantine({
      errorCode,
      originalEventId,
      originalStream: this.names.stream,
      originalStreamSequence: streamSequence,
      originalSubject: message.subject,
      durable: this.durable,
    });
    const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
    const msgId = quarantineMsgId(this.durable, streamSequence);

    while (this.running) {
      try {
        await this.broker.publishTo(this.names.quarantineSubject, payload, msgId);
        if (!this.running) return;
        message.ack();
        this.state.markAcked();
        await this.control?.observeWorker(this.alias, null);
        this.state.setState('idle');
        this.attempt = 0;
        this.log.warn({
          event: 'search_event_quarantined',
          index: this.alias,
          durable: this.durable,
          errorCode,
          eventId: originalEventId,
          streamSequence,
        });
        return;
      } catch (error) {
        this.recordFailure(error, 'search_quarantine_retry', originalEventId ?? undefined);
        this.state.markError('quarantine_publish_failed');
        await this.wake.backoff(this.nextDelayMs());
      }
    }
  }

  private haltOn(error: unknown): void {
    const code = error instanceof IndexConfigMismatchError
      ? 'config_mismatch'
      : error instanceof ConsumerContractError
        ? 'consumer_contract'
        : (meiliErrorCode(error) ?? 'config_error');
    this.state.halt(code);
    this.state.setReachable(true);
    this.log.error({
      event: 'search_worker_halted',
      index: this.alias,
      durable: this.durable,
      code,
      fields: error instanceof IndexConfigMismatchError || error instanceof ConsumerContractError
        ? error.fields
        : undefined,
    });
  }

  /** Stable code, never the raw error object, a URL or an API key. */
  private recordFailure(error: unknown, logEvent: string, eventId?: string): void {
    if (error instanceof IndexConfigMismatchError || error instanceof ConsumerContractError) {
      this.haltOn(error);
      return;
    }
    if (classifyMeiliError(error) === 'config') {
      this.haltOn(error);
      return;
    }
    const code = error instanceof MeiliTaskFailedError
      ? (error.errorCode ?? 'task_failed')
      : error instanceof MeiliTaskTimeoutError
        ? 'task_timeout'
        : (meiliErrorCode(error) ?? 'transient');
    this.state.setState('retrying');
    this.state.markError(code);
    this.state.setReachable(false);
    this.log.warn({
      event: logEvent,
      index: this.alias,
      durable: this.durable,
      eventId,
      code,
      attempt: this.attempt,
      delayMs: this.peekDelayMs(),
    });
  }

  private peekDelayMs(): number {
    return peekRetryDelayMs(this.attempt, this.retryDelays);
  }

  private nextDelayMs(): number {
    const delay = retryDelayMs(this.attempt, this.retryDelays);
    this.attempt += 1;
    return delay;
  }

  /**
   * Durable pause handshake used by reindex. It is checked immediately before
   * every fetch. An already-held message is deliberately not interrupted: its
   * Meili task and ACK finish first, then the next loop iteration acknowledges
   * the pause without asking JetStream for another delivery.
   */
  private async pauseWhenRequested(): Promise<boolean> {
    if (this.control === null) return false;
    const row = await this.control.get(this.alias);
    if (row === null) {
      this.state.halt('control_row_missing');
      await this.wake.backoff(HALT_POLL_MS);
      return true;
    }
    await this.control.observeWorker(this.alias, this.state.inFlightEventId);
    if (row.desiredWorkerState !== 'paused') {
      if (this.state.state === 'paused') this.state.setState('idle');
      return false;
    }
    if (this.state.inFlightEventId === null) {
      this.state.setState('paused');
      await this.control.acknowledgePaused(this.alias);
    }
    await this.wake.backoff(250);
    return true;
  }
}
