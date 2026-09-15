import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { ProcessingStatusController } from './processing-status.controller.js';
import { PermissionGuard } from '../content/permission.guard.js';

@Module({
  imports: [ContentModule, MessagingModule],
  controllers: [ProcessingStatusController],
  providers: [PermissionGuard],
})
export class OpsModule {}
