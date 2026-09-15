import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { JetStreamAdapter } from './jetstream.adapter.js';
import { OutboxRelay } from './relay.js';
import { RelayState } from './relay.state.js';

@Module({
  imports: [ContentModule],
  providers: [JetStreamAdapter, RelayState, OutboxRelay],
  exports: [JetStreamAdapter, RelayState, OutboxRelay],
})
export class MessagingModule {}
