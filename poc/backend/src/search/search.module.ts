import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentModule } from '../content/content.module.js';
import { JetStreamAdapter } from '../messaging/jetstream.adapter.js';
import { CatalogSearchController } from './catalog-search.controller.js';
import { SEARCH_BROKER, SearchRegistry } from './search.registry.js';
import { SearchService } from './search.service.js';
import { SearchState } from './worker.state.js';

/**
 * The search stack gets its own JetStream connection rather than sharing the
 * relay's. They have different lifecycles — the relay stops when the outbox is
 * drained, the workers keep consuming — and a shared adapter would let one
 * side's shutdown abort the other's in-flight operation.
 */
@Module({
  imports: [ContentModule],
  controllers: [CatalogSearchController],
  providers: [
    SearchState,
    {
      provide: SEARCH_BROKER,
      useFactory: (config: ConfigService) => new JetStreamAdapter(config),
      inject: [ConfigService],
    },
    SearchRegistry,
    SearchService,
  ],
  exports: [SearchState, SearchRegistry, SearchService],
})
export class SearchModule {}
