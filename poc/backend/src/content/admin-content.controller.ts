import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  normalizeCreateCommand, normalizePatchCommand, normalizeVersionedCommand, parseContentId, toAdminView,
  type AdminContentView,
} from '../contracts/http.js';
import { operationContext } from '../identity/actor.js';
import { ContentService } from './content.service.js';
import { PermissionGuard, RequirePermission } from './permission.guard.js';

const CONFLICTS = '409 version_conflict, state conflict or slug_conflict';

@ApiTags('admin')
@Controller('admin/contents')
@UseGuards(PermissionGuard)
export class AdminContentController {
  constructor(@Inject(ContentService) private readonly service: ContentService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('content:write')
  @ApiOperation({ summary: 'Create a draft content' })
  @ApiResponse({ status: 201, description: 'Draft created at version 1' })
  @ApiResponse({ status: 409, description: 'slug_conflict for a manual slug already in use' })
  @ApiResponse({ status: 422, description: 'validation_failed with the offending field names' })
  async create(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<AdminContentView> {
    return toAdminView(await this.service.create(normalizeCreateCommand(body), operationContext(res)));
  }

  @Patch(':id')
  @RequirePermission('content:write')
  @ApiOperation({ summary: 'Edit a draft or withdrawn content' })
  @ApiResponse({ status: 200, description: 'Updated, or the unchanged record on a no-op' })
  @ApiResponse({ status: 409, description: CONFLICTS })
  async patch(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminContentView> {
    const contentId = parseContentId(id);
    return toAdminView(await this.service.patch(contentId, normalizePatchCommand(body), operationContext(res)));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('content:publish')
  @ApiOperation({ summary: 'Publish a draft or withdrawn content' })
  @ApiResponse({ status: 200, description: 'Published; the DB write is committed, searchability is not implied' })
  @ApiResponse({ status: 409, description: CONFLICTS })
  async publish(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminContentView> {
    const contentId = parseContentId(id);
    return toAdminView(await this.service.publish(contentId, normalizeVersionedCommand(body), operationContext(res)));
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermission('content:publish')
  @ApiOperation({ summary: 'Withdraw a published content' })
  @ApiResponse({ status: 200, description: 'Withdrawn; the slug stays reserved' })
  @ApiResponse({ status: 409, description: CONFLICTS })
  async withdraw(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminContentView> {
    const contentId = parseContentId(id);
    return toAdminView(await this.service.withdraw(contentId, normalizeVersionedCommand(body), operationContext(res)));
  }

  @Get(':id')
  @RequirePermission('content:read')
  @ApiOperation({ summary: 'Editorial detail in every state' })
  @ApiResponse({ status: 200, description: 'Editorial view including mediaAssetId' })
  @ApiResponse({ status: 404, description: 'content_not_found' })
  async get(@Param('id') id: string): Promise<AdminContentView> {
    return toAdminView(await this.service.findForAdmin(parseContentId(id)));
  }
}
