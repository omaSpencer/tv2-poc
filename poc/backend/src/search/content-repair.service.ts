import { Inject, Injectable } from '@nestjs/common';
import type { SearchIndexAlias } from '../contracts/search.js';
import { ContentRepository } from '../content/content.repository.js';
import { DatabaseService } from '../database.js';
import { MeiliTaskFailedError } from './meili.adapter.js';
import { projectionFor } from './projection.js';
import { SearchRegistry } from './search.registry.js';
import { OperatorActionExecutionError } from '../ops/operator-action.error.js';

export type ContentRepairTarget = SearchIndexAlias | 'both';
export type ContentRepairResult = {
  contentId: string;
  tasks: Array<{ alias: SearchIndexAlias; taskUid: number }>;
};

@Injectable()
export class ContentRepairService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ContentRepository) private readonly repository: ContentRepository,
    @Inject(SearchRegistry) private readonly registry: SearchRegistry,
  ) {}

  async repair(contentId: string, target: ContentRepairTarget): Promise<ContentRepairResult> {
    const row = await this.repository.findById(this.database.db, contentId);
    if (!row) throw new OperatorActionExecutionError('repair_target_unknown');
    const decision = projectionFor(contentId, row);
    if (decision.operation === 'reject') throw new OperatorActionExecutionError('repair_task_failed');
    const aliases: SearchIndexAlias[] = target === 'both' ? ['a', 'b'] : [target];
    const tasks: ContentRepairResult['tasks'] = [];
    for (const alias of aliases) {
      try {
        const adapter = this.registry.adapter(alias);
        const taskUid = decision.operation === 'upsert'
          ? await adapter.submitUpsert(decision.document)
          : await adapter.submitDelete(decision.id);
        const task = await adapter.awaitTask(taskUid);
        if (task.status !== 'succeeded') throw new MeiliTaskFailedError(task.uid, task.errorCode);
        tasks.push({ alias, taskUid: task.uid });
      } catch (error) {
        // Safe metadata only; no content projection or endpoint is attached.
        process.stderr.write(JSON.stringify({
          event: 'content_repair_failed',
          contentId,
          alias,
          completedTasks: tasks,
          code: error instanceof OperatorActionExecutionError ? error.code : 'repair_task_failed',
        }) + '\n');
        throw error instanceof OperatorActionExecutionError
          ? error
          : new OperatorActionExecutionError('repair_task_failed');
      }
    }
    return { contentId, tasks };
  }
}
