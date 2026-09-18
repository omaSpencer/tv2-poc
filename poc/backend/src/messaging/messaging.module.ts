import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { JetStreamAdapter } from './jetstream.adapter.js';
import { OutboxRelay } from './relay.js';
import { RelayState } from './relay.state.js';
import { ObservabilityModule } from '../observability/logger.js';

@Module({
  imports: [ContentModule, ObservabilityModule],
  providers: [JetStreamAdapter, RelayState, OutboxRelay],
  exports: [JetStreamAdapter, RelayState, OutboxRelay],
})
export class MessagingModule {}
