import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  normalizeCreateCommand, normalizePatchCommand, normalizeVersionedCommand, parseContentId, toAdminView,
  type AdminContentView,
} from '../contracts/http.js';
import { jsonResponse, problemResponse, schemaRef } from '../contracts/openapi.js';
import { operationContext } from '../identity/actor.js';
import { ContentService } from './content.service.js';
import { PermissionGuard, RequirePermission } from './permission.guard.js';
import {
  ADMIN_CONTENT_LIST_LIMITS,
  CONTENT_AUDIT_LIMITS,
  parseAdminContentListQuery,
  parseContentAuditQuery,
  type AdminContentListView,
  type ContentAuditListView,
} from '../contracts/admin-content-list.js';

const CONFLICTS = '409 version_conflict, state conflict or slug_conflict';

/** Path parameter shared by every single-content route. */
const ID_PARAM = { name: 'id', required: true, schema: { type: 'string', format: 'uuid' } } as const;

/**
 * The request bodies are documented from the same Zod objects the normalisation
 * path parses with (`src/contracts/openapi.ts`), so the published schema and
 * the enforced rule cannot drift apart. `@Body() body: unknown` stays: Nest
 * must not run a second, differently-behaving validation pipe.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/contents')
@UseGuards(PermissionGuard)
export class AdminContentController {
  constructor(@Inject(ContentService) private readonly service: ContentService) {}

  @Post()
  @HttpCode(201)
  @RequirePermission('content:write')
  @ApiOperation({ summary: 'Create a draft content' })
  @ApiResponse({ status: 413, ...problemResponse('payload_too_large: request body exceeds 256 KB') })
  @ApiBody({ required: true, schema: schemaRef('CreateContentBody') })
  @ApiResponse({ status: 201, ...jsonResponse('AdminContentView', 'Draft created at version 1') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:write is required') })
  @ApiResponse({ status: 409, ...problemResponse('slug_conflict for a manual slug already in use') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed with the offending field names') })
  async create(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<AdminContentView> {
    return toAdminView(await this.service.create(normalizeCreateCommand(body), operationContext(res)));
  }

  @Patch(':id')
  @RequirePermission('content:write')
  @ApiOperation({ summary: 'Edit a draft or withdrawn content' })
  @ApiParam(ID_PARAM)
  @ApiResponse({ status: 413, ...problemResponse('payload_too_large: request body exceeds 256 KB') })
  @ApiBody({ required: true, schema: schemaRef('PatchContentBody') })
  @ApiResponse({ status: 200, ...jsonResponse('AdminContentView', 'Updated, or the unchanged record on a no-op') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:write is required') })
  @ApiResponse({ status: 404, ...problemResponse('content_not_found') })
  @ApiResponse({ status: 409, ...problemResponse(CONFLICTS) })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed with the offending field names') })
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
  @ApiParam(ID_PARAM)
  @ApiResponse({ status: 413, ...problemResponse('payload_too_large: request body exceeds 256 KB') })
  @ApiBody({ required: true, schema: schemaRef('VersionedCommandBody') })
  @ApiResponse({
    status: 200,
    ...jsonResponse('AdminContentView', 'Published; the DB write is committed, searchability is not implied'),
  })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:publish is required') })
  @ApiResponse({ status: 404, ...problemResponse('content_not_found') })
  @ApiResponse({ status: 409, ...problemResponse(CONFLICTS) })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed with the offending field names') })
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
  @ApiParam(ID_PARAM)
  @ApiResponse({ status: 413, ...problemResponse('payload_too_large: request body exceeds 256 KB') })
  @ApiBody({ required: true, schema: schemaRef('VersionedCommandBody') })
  @ApiResponse({ status: 200, ...jsonResponse('AdminContentView', 'Withdrawn; the slug stays reserved') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:publish is required') })
  @ApiResponse({ status: 404, ...problemResponse('content_not_found') })
  @ApiResponse({ status: 409, ...problemResponse(CONFLICTS) })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed with the offending field names') })
  async withdraw(
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminContentView> {
    const contentId = parseContentId(id);
    return toAdminView(await this.service.withdraw(contentId, normalizeVersionedCommand(body), operationContext(res)));
  }

  @Get()
  @RequirePermission('content:read')
  @ApiOperation({ summary: 'List editorial content with stable cursor pagination' })
  @ApiQuery({ name: 'q', required: false, schema: { type: 'string', minLength: 1, maxLength: ADMIN_CONTENT_LIST_LIMITS.queryMax } })
  @ApiQuery({ name: 'status', required: false, schema: { type: 'string', enum: ['draft', 'published', 'withdrawn'] } })
  @ApiQuery({ name: 'category', required: false, schema: { type: 'string', enum: ['film', 'sorozat', 'hir', 'sport', 'szorakozas', 'egyeb'] } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: ADMIN_CONTENT_LIST_LIMITS.min, maximum: ADMIN_CONTENT_LIST_LIMITS.max, default: ADMIN_CONTENT_LIST_LIMITS.default } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', description: 'Opaque base64url cursor.' } })
  @ApiResponse({ status: 200, ...jsonResponse('AdminContentListView', 'Editorial list without full content payloads') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:read is required') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed for invalid, unknown or repeated query fields') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async list(@Req() req: Request): Promise<AdminContentListView> {
    const params = new URL(req.originalUrl, 'http://internal.invalid').searchParams;
    return this.service.listForAdmin(parseAdminContentListQuery(params));
  }

  @Get(':id/audit')
  @RequirePermission('content:read')
  @ApiOperation({ summary: 'List the append-only content audit trail, newest first' })
  @ApiParam(ID_PARAM)
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: CONTENT_AUDIT_LIMITS.min, maximum: CONTENT_AUDIT_LIMITS.max, default: CONTENT_AUDIT_LIMITS.default } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string', description: 'Opaque base64url cursor.' } })
  @ApiResponse({ status: 200, ...jsonResponse('ContentAuditListView', 'Audit metadata without request bodies or field values') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:read is required') })
  @ApiResponse({ status: 404, ...problemResponse('content_not_found') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed for id, cursor or query fields') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async audit(@Param('id') id: string, @Req() req: Request): Promise<ContentAuditListView> {
    const params = new URL(req.originalUrl, 'http://internal.invalid').searchParams;
    return this.service.listAuditForAdmin(parseContentId(id), parseContentAuditQuery(params));
  }

  @Get(':id')
  @RequirePermission('content:read')
  @ApiOperation({ summary: 'Editorial detail in every state' })
  @ApiParam(ID_PARAM)
  @ApiResponse({ status: 200, ...jsonResponse('AdminContentView', 'Editorial view including mediaAssetId') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; content:read is required') })
  @ApiResponse({ status: 404, ...problemResponse('content_not_found') })
  async get(@Param('id') id: string): Promise<AdminContentView> {
    return toAdminView(await this.service.findForAdmin(parseContentId(id)));
  }
}
