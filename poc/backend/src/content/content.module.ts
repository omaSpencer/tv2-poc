import { Module } from '@nestjs/common';
import { AdminContentController } from './admin-content.controller.js';
import { CatalogContentController } from './catalog-content.controller.js';
import { ContentRepository } from './content.repository.js';
import { ContentService } from './content.service.js';
import { PermissionGuard } from './permission.guard.js';
import { OutboxRepository } from '../outbox/outbox.repository.js';

@Module({
  controllers: [AdminContentController, CatalogContentController],
  providers: [ContentService, ContentRepository, OutboxRepository, PermissionGuard],
  exports: [ContentService, ContentRepository, OutboxRepository],
})
export class ContentModule {}
