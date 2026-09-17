import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SearchModule } from '../search/search.module.js';
import { ProcessingStatusController } from './processing-status.controller.js';
import { PermissionGuard } from '../content/permission.guard.js';
import { OperatorActionRepository } from './operator-action.repository.js';
import { OperatorActionExecutor } from './operator-action.executor.js';
import { OperatorActionRunner } from './operator-action.runner.js';
import { OperatorActionsController } from './operator-actions.controller.js';

@Module({
  imports: [ContentModule, MessagingModule, SearchModule],
  controllers: [ProcessingStatusController, OperatorActionsController],
  providers: [PermissionGuard, OperatorActionRepository, OperatorActionExecutor, OperatorActionRunner],
  exports: [OperatorActionRepository, OperatorActionRunner],
})
export class OpsModule {}
