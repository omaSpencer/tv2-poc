import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database.js';
import { ReindexRunError } from '../search/reindex/importer.js';
import { ReindexControlRepository } from '../search/reindex/control.repository.js';
import { OperatorActionExecutionError } from './operator-action.error.js';
import { OperatorActionExecutor } from './operator-action.executor.js';
import { OperatorActionRepository, type OperatorActionRecord } from './operator-action.repository.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable()
export class OperatorActionRunner implements OnModuleInit, OnApplicationShutdown {
  private stopping = false;
  private recoveryPending = true;
  private dependencyFailureReported = false;
  private activeSignal: { aborted: boolean } | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OperatorActionRepository) private readonly repository: OperatorActionRepository,
    @Inject(OperatorActionExecutor) private readonly executor: OperatorActionExecutor,
    @Inject(ReindexControlRepository) private readonly control: ReindexControlRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.tryRecovery();
    this.loopPromise = this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.activeSignal) this.activeSignal.aborted = true;
    await this.loopPromise;
  }

  wake(): void {
    // Polling is bounded; a later LISTEN/NOTIFY optimization can use this hook.
  }

  private async loop(): Promise<void> {
    const pollMs = this.config.get<number>('OPERATOR_ACTION_POLL_MS') ?? 250;
    while (!this.stopping) {
      if (this.recoveryPending) {
        await this.tryRecovery();
        if (this.recoveryPending) {
          await delay(Math.max(pollMs, 1000));
          continue;
        }
      }
      let action: OperatorActionRecord | null;
      try {
        action = await this.repository.claimNext();
        this.dependencyFailureReported = false;
      } catch {
        this.reportDependencyFailure('operator_action_claim_deferred');
        action = null;
      }
      if (!action) {
        await delay(pollMs);
        continue;
      }
      await this.run(action);
    }
  }

  private async tryRecovery(): Promise<void> {
    const staleMs = this.config.get<number>('OPERATOR_ACTION_STALE_MS') ?? 30_000;
    try {
      await this.database.transaction(async tx => {
        const recovered = await this.repository.recoverStale(new Date(Date.now() - staleMs), tx);
        for (const action of recovered) {
          if (action.kind === 'reindex' && 'index' in action.target) {
            await this.control.fail(action.target.index, 'aborted', tx);
          }
        }
      });
      this.recoveryPending = false;
      this.dependencyFailureReported = false;
    } catch {
      // Database readiness owns startup health. Recovery remains pending and is
      // retried before any new action can be claimed.
      this.reportDependencyFailure('operator_action_recovery_deferred');
    }
  }

  private reportDependencyFailure(event: string): void {
    if (this.dependencyFailureReported) return;
    this.dependencyFailureReported = true;
    process.stderr.write(JSON.stringify({ event, code: 'dependency_unavailable' }) + '\n');
  }

  private async run(action: OperatorActionRecord): Promise<void> {
    const signal = { aborted: false };
    this.activeSignal = signal;
    const heartbeatMs = this.config.get<number>('OPERATOR_ACTION_HEARTBEAT_MS') ?? 5000;
    const heartbeat = setInterval(() => {
      void this.repository.heartbeat(action.id).catch(() => undefined);
    }, heartbeatMs);
    try {
      const result = await this.executor.execute(action, signal);
      if (signal.aborted) throw new OperatorActionExecutionError('aborted');
      await this.repository.succeed(action.id, result);
    } catch (error) {
      const code = error instanceof OperatorActionExecutionError || error instanceof ReindexRunError
        ? error.code
        : 'internal_error';
      process.stderr.write(JSON.stringify({
        event: 'operator_action_failed',
        actionId: action.id,
        kind: action.kind,
        code,
        correlationId: action.correlationId,
      }) + '\n');
      await this.repository.fail(action.id, code).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      this.activeSignal = null;
    }
  }
}
