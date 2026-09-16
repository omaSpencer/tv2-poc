/**
 * Public search read path (M4-06).
 *
 * Meilisearch answers one question only: *which ids match, in what order*. Every
 * field in the response and the decision that a hit is still published come from
 * one PostgreSQL query. That is what makes a stale index harmless — a withdrawn
 * document left behind in one instance simply drops out of the page — and it is
 * why an editorial field cannot leak through the search route even if one were
 * indexed by mistake.
 *
 * The A → B fallback is deliberately narrow. Only failures that another healthy
 * instance could plausibly answer (network, timeout, 429, 5xx) are retried on B.
 * A rejected API key or a settings mismatch is an operator problem: masking it
 * behind a working B would leave a broken instance broken and unnoticed.
 */
import { Inject, Injectable } from '@nestjs/common';
import { pino, type Logger } from 'pino';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '../contracts/errors.js';
import { toPublicView, type PublicContentView } from '../contracts/http.js';
import type { CatalogSearchQuery, CatalogSearchView, SearchIndexAlias } from '../contracts/search.js';
import { DatabaseService, isConnectionFailure } from '../database.js';
import { ContentRepository } from '../content/content.repository.js';
import { classifyMeiliError, meiliErrorCode, type MeiliSearchHits } from './meili.adapter.js';
import { SearchRegistry } from './search.registry.js';
import { SearchState } from './worker.state.js';

const searchUnavailable = () =>
  new ApiError('search_unavailable', 'The search index is currently unavailable.');

@Injectable()
export class SearchService {
  private readonly log: Logger;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(SearchRegistry) private readonly registry: SearchRegistry,
    @Inject(SearchState) private readonly state: SearchState,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ContentRepository) private readonly repository: ContentRepository,
  ) {
    this.log = pino({ level: config.get<string>('LOG_LEVEL') ?? 'info' });
  }

  async search(query: CatalogSearchQuery): Promise<CatalogSearchView> {
    if (!this.registry.enabled) {
      // No worker, no client, no network call: a stable, documented 503.
      throw searchUnavailable();
    }

    const hits = await this.route(query);
    const items = await this.hydrate(hits.ids, query.category);
    return {
      items,
      offset: query.offset,
      limit: query.limit,
      returned: items.length,
      estimatedTotalHits: hits.estimatedTotalHits,
    };
  }

  /** At most one A call and, when A fails transiently, at most one B call. */
  private async route(query: CatalogSearchQuery): Promise<MeiliSearchHits> {
    if (this.routable('a')) {
      try {
        return await this.queryInstance('a', query);
      } catch (error) {
        const kind = classifyMeiliError(error);
        if (kind !== 'transient' && kind !== 'not_found') {
          // 4xx, auth or configuration: no fallback, and no detail to the client.
          this.log.error({
            event: 'search_failed',
            index: 'a',
            kind,
            code: meiliErrorCode(error) ?? 'unclassified',
          });
          throw searchUnavailable();
        }
        this.log.warn({ event: 'search_fallback', from: 'a', to: 'b', kind });
      }
    } else if (this.state.get('a').state === 'halted') {
      // A halted instance is an operator problem that must stay visible.
      this.log.error({ event: 'search_failed', index: 'a', kind: 'halted', code: this.state.get('a').lastErrorCode });
      throw searchUnavailable();
    } else {
      this.log.warn({ event: 'search_fallback', from: 'a', to: 'b', kind: 'not_routable' });
    }

    if (!this.routable('b')) throw searchUnavailable();
    try {
      return await this.queryInstance('b', query);
    } catch (error) {
      this.log.error({
        event: 'search_failed',
        index: 'b',
        kind: classifyMeiliError(error),
        code: meiliErrorCode(error) ?? 'unclassified',
      });
      throw searchUnavailable();
    }
  }

  /**
   * An instance is routable once its own bootstrap has succeeded. `off` and
   * `bootstrapping` are not failures — they simply are not ready to answer, so
   * the other instance is tried directly.
   */
  private routable(alias: SearchIndexAlias): boolean {
    const index = this.state.get(alias);
    return index.bootstrapped
      && (index.state === 'idle' || index.state === 'processing' || index.state === 'retrying');
  }

  private async queryInstance(alias: SearchIndexAlias, query: CatalogSearchQuery): Promise<MeiliSearchHits> {
    const adapter = this.registry.adapter(alias);
    return adapter.search(query.q, {
      category: query.category,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * One query, restricted to currently published rows and — when the caller
   * filtered — to the current category. The index order is restored here rather
   * than in SQL, because relevance is the index's judgement, not the database's.
   */
  private async hydrate(
    ids: readonly string[],
    category: CatalogSearchQuery['category'],
  ): Promise<PublicContentView[]> {
    if (ids.length === 0) return [];
    let rows;
    try {
      rows = await this.repository.findPublishedByIds(this.database.db, ids, category);
    } catch (error) {
      if (isConnectionFailure(error)) {
        // Never answer from index metadata: the index has no published state.
        throw new ApiError('dependency_unavailable', 'The database is currently unavailable.');
      }
      throw error;
    }
    const byId = new Map(rows.map(row => [row.id, row]));
    const items: PublicContentView[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      // A hit with no surviving row is dropped; the page is simply shorter.
      if (row !== undefined) items.push(toPublicView(row));
    }
    return items;
  }
}
