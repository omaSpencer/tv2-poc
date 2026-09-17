import { Inject, Injectable } from '@nestjs/common';
import { ContentRepairService } from '../search/content-repair.service.js';
import { QuarantineService } from '../search/quarantine.service.js';
import { ReindexCoordinator } from '../search/reindex/coordinator.js';
import { OperatorActionExecutionError } from './operator-action.error.js';
import type { OperatorActionRecord } from './operator-action.repository.js';

@Injectable()
export class OperatorActionExecutor {
  constructor(
    @Inject(ReindexCoordinator) private readonly reindex: ReindexCoordinator,
    @Inject(QuarantineService) private readonly quarantine: QuarantineService,
    @Inject(ContentRepairService) private readonly repairService: ContentRepairService,
  ) {}

  async execute(action: OperatorActionRecord, signal: { aborted: boolean }): Promise<unknown> {
    switch (action.kind) {
      case 'reindex': {
        if (!('index' in action.target) || !('allowSearchOutage' in action.target)) {
          throw new OperatorActionExecutionError('internal_error');
        }
        const result = await this.reindex.run({
          runId: action.id,
          index: action.target.index,
          allowSearchOutage: action.target.allowSearchOutage,
          confirmTarget: action.target.confirmationTarget ?? undefined,
          signal,
        });
        return {
          runId: result.runId,
          index: result.index,
          snapshotStreamSequence: result.snapshotStreamSequence,
          catchUpStreamSequence: result.catchUpStreamSequence,
          expectedDocuments: result.expectedDocuments,
          durationMs: result.durationMs,
        };
      }
      case 'quarantine_replay': {
        if (!('sequence' in action.target)) throw new OperatorActionExecutionError('internal_error');
        return this.quarantine.replay(action.target.sequence, action.reason, action.id);
      }
      case 'content_repair': {
        if (!('contentId' in action.target) || !('target' in action.target)) {
          throw new OperatorActionExecutionError('internal_error');
        }
        return this.repairService.repair(action.target.contentId, action.target.target);
      }
    }
  }
}
