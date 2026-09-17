import {
  SEARCH_DISPLAYED_ATTRIBUTES, SEARCH_FILTERABLE_ATTRIBUTES, SEARCH_SEARCHABLE_ATTRIBUTES,
  SEARCH_SORTABLE_ATTRIBUTES, type SearchProjectionV1,
} from '../../contracts/search.js';
import { stagingIndexUid, type ReindexErrorCode } from '../../contracts/reindex.js';
import type { MeiliIndexAdapter, MeiliTaskResult } from '../meili.adapter.js';
import type { ReindexControlRepository } from './control.repository.js';

export class ReindexRunError extends Error {
  constructor(readonly code: ReindexErrorCode, message: string = code) {
    super(message);
    this.name = 'ReindexRunError';
  }
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class StagingImporter {
  readonly stagingUid: string;

  constructor(
    private readonly adapter: MeiliIndexAdapter,
    private readonly control: ReindexControlRepository,
    private readonly alias: 'a' | 'b',
    runId: string,
  ) {
    this.stagingUid = stagingIndexUid(adapter.indexUid, runId);
  }

  private async succeeded(taskUid: number, code: ReindexErrorCode): Promise<MeiliTaskResult> {
    const task = await this.adapter.awaitTask(taskUid);
    if (task.status !== 'succeeded') throw new ReindexRunError(code);
    return task;
  }

  async prepare(): Promise<void> {
    const deletion = await this.adapter.deleteNamedIndex(this.stagingUid);
    if (deletion !== null) await this.succeeded(deletion, 'import_task_failed');
    await this.succeeded(await this.adapter.createNamedIndex(this.stagingUid), 'import_task_failed');
    await this.succeeded(await this.adapter.applyManagedSettingsTo(this.stagingUid), 'import_task_failed');
    const settings = await this.adapter.managedSettingsOf(this.stagingUid);
    if (!same(settings.searchableAttributes, SEARCH_SEARCHABLE_ATTRIBUTES)
      || !same(settings.filterableAttributes, SEARCH_FILTERABLE_ATTRIBUTES)
      || !same(settings.displayedAttributes, SEARCH_DISPLAYED_ATTRIBUTES)
      || !same(settings.sortableAttributes, SEARCH_SORTABLE_ATTRIBUTES)) {
      throw new ReindexRunError('import_task_failed', 'staging_settings_mismatch');
    }
  }

  async import(documents: SearchProjectionV1[]): Promise<void> {
    if (documents.length === 0) return;
    await this.succeeded(await this.adapter.submitBatch(this.stagingUid, documents), 'import_task_failed');
    await this.control.addImported(this.alias, documents.length);
  }

  async assertCount(expected: number): Promise<void> {
    if (await this.adapter.documentCount(this.stagingUid) !== expected) {
      throw new ReindexRunError('import_count_mismatch');
    }
  }

  async swap(): Promise<void> {
    try {
      await this.succeeded(await this.adapter.swapWithLive(this.stagingUid), 'swap_task_failed');
    } catch (error) {
      if (error instanceof ReindexRunError) throw error;
      // Submission failures happen before a Meilisearch task id exists, but
      // are still a swap failure rather than an opaque internal error.
      throw new ReindexRunError('swap_task_failed');
    }
  }

  async cleanupOldIndex(): Promise<void> {
    const task = await this.adapter.deleteNamedIndex(this.stagingUid);
    if (task !== null) await this.succeeded(task, 'import_task_failed');
  }
}
