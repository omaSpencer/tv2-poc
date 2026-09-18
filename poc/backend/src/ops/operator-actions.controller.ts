import {
  Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PermissionGuard, RequirePermission } from '../content/permission.guard.js';
import { ApiError, validationFailed } from '../contracts/errors.js';
import {
  encodeQuarantineCursor,
  normalizeRepairBody,
  normalizeReplayBody,
  normalizeStartReindexBody,
  operatorRequestFingerprint,
  parseIdempotencyKey,
  parseQuarantineListQuery,
  type OperatorActionTarget,
} from '../contracts/operator-actions.js';
import { jsonResponse, problemResponse, schemaRef } from '../contracts/openapi.js';
import { operationContext, type OperationContext } from '../identity/actor.js';
import { QuarantineService } from '../search/quarantine.service.js';
import { ReindexCoordinator } from '../search/reindex/coordinator.js';
import { ReindexControlRepository } from '../search/reindex/control.repository.js';
import { OperatorActionExecutionError } from './operator-action.error.js';
import { dependencyRead } from './dependency-read.js';
import { OperatorActionRepository } from './operator-action.repository.js';
import { OperatorActionRunner } from './operator-action.runner.js';
import { toOperatorActionView, type OperatorActionView } from './operator-action.view.js';

const UUID_PARAM = { name: 'id', required: true, schema: { type: 'string', format: 'uuid' } } as const;

@ApiTags('admin-operations')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(PermissionGuard)
export class OperatorActionsController {
  constructor(
    @Inject(OperatorActionRepository) private readonly actions: OperatorActionRepository,
    @Inject(OperatorActionRunner) private readonly runner: OperatorActionRunner,
    @Inject(ReindexCoordinator) private readonly reindex: ReindexCoordinator,
    @Inject(ReindexControlRepository) private readonly control: ReindexControlRepository,
    @Inject(QuarantineService) private readonly quarantine: QuarantineService,
  ) {}

  @Get('search/reindex-preflight')
  @RequirePermission('ops:write')
  @ApiOperation({ summary: 'Check whether a reindex can be started' })
  @ApiQuery({ name: 'index', required: true, schema: { type: 'string', enum: ['a', 'b'] } })
  @ApiQuery({ name: 'allowSearchOutage', required: false, schema: { type: 'boolean', default: false } })
  @ApiResponse({ status: 200, ...jsonResponse('ReindexPreflightView', 'Live, non-reserving reindex preflight') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:write is required') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async preflight(@Req() req: Request) {
    const params = new URL(req.originalUrl, 'http://internal.invalid').searchParams;
    const index = params.getAll('index');
    const outage = params.getAll('allowSearchOutage');
    const fields: string[] = [];
    if (index.length !== 1 || (index[0] !== 'a' && index[0] !== 'b')) fields.push('index');
    if (outage.length > 1 || (outage[0] !== undefined && outage[0] !== 'true' && outage[0] !== 'false')) {
      fields.push('allowSearchOutage');
    }
    for (const key of params.keys()) if (key !== 'index' && key !== 'allowSearchOutage') fields.push(key);
    if (fields.length > 0) throw validationFailed(fields);
    const requestedIndex = index[0] as 'a' | 'b';
    const [view, active] = await dependencyRead(() => Promise.all([
      this.reindex.preflight(requestedIndex, outage[0] === 'true'),
      this.actions.activeReindex(),
    ]));
    if (!active || view.blockers.includes('active_run')) return view;
    return {
      ...view,
      activeRunId: active.id,
      canStartNormally: false,
      blockers: ['active_run' as const, ...view.blockers],
    };
  }

  @Post('search/reindex-runs')
  @HttpCode(202)
  @RequirePermission('ops:write')
  @ApiBody({ schema: schemaRef('StartReindexBody') })
  @ApiResponse({ status: 202, ...jsonResponse('OperatorActionView', 'Queued or existing idempotent action') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:write is required') })
  @ApiResponse({ status: 409, ...problemResponse('idempotency_conflict or reindex_already_running') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed or target_confirmation_required') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async startReindex(
    @Headers('idempotency-key') rawKey: unknown,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperatorActionView> {
    const key = parseIdempotencyKey(rawKey);
    const body = normalizeStartReindexBody(rawBody);
    const preflight = await dependencyRead(() => this.reindex.preflight(body.index, body.allowSearchOutage));
    if (preflight.confirmationRequired && body.confirmTarget !== preflight.confirmationTarget) {
      throw new ApiError('target_confirmation_required', 'The exact target database name is required.');
    }
    const target: OperatorActionTarget = {
      index: body.index,
      allowSearchOutage: body.allowSearchOutage,
      confirmationTarget: body.confirmTarget ?? null,
    };
    return this.admit(key, 'reindex', body.reason, target, operationContext(res));
  }

  @Get('search/reindex-runs/:runId')
  @RequirePermission('ops:read')
  @ApiParam({ name: 'runId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({ status: 200, ...jsonResponse('ReindexRunView', 'Action plus current durable reindex progress') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:read is required') })
  @ApiResponse({ status: 404, ...problemResponse('operation_not_found') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async reindexRun(@Param('runId') runId: string) {
    const action = await this.action(runId);
    if (action.kind !== 'reindex') throw new ApiError('operation_not_found', 'No reindex run exists for the given id.');
    const target = action.target as { index: 'a' | 'b' };
    const control = await this.reindexControl(target.index, runId);
    return { ...toOperatorActionView(action), progress: control };
  }

  @Get('search/quarantine')
  @RequirePermission('ops:read')
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' } })
  @ApiResponse({ status: 200, ...jsonResponse('QuarantineListView', 'Newest-first payload-free quarantine list') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:read is required') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async quarantineList(@Req() req: Request) {
    const query = parseQuarantineListQuery(new URL(req.originalUrl, 'http://internal.invalid').searchParams);
    const result = await dependencyRead(() => this.quarantine.list(query));
    return {
      items: result.items,
      nextCursor: result.nextBeforeSequence === null ? null : encodeQuarantineCursor(result.nextBeforeSequence),
    };
  }

  @Get('search/quarantine/:sequence')
  @RequirePermission('ops:read')
  @ApiParam({ name: 'sequence', required: true, schema: { type: 'integer', minimum: 1 } })
  @ApiResponse({ status: 200, ...jsonResponse('QuarantineItemView', 'Payload-free quarantine metadata') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:read is required') })
  @ApiResponse({ status: 404, ...problemResponse('quarantine_not_found') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async quarantineDetail(@Param('sequence') rawSequence: string) {
    const sequence = this.sequence(rawSequence);
    try {
      return await dependencyRead(() => this.quarantine.inspect(sequence));
    } catch (error) {
      if (error instanceof OperatorActionExecutionError && error.code === 'quarantine_not_found') {
        throw new ApiError('quarantine_not_found', 'No quarantine record exists for the given sequence.');
      }
      throw error;
    }
  }

  @Post('search/quarantine/:sequence/replays')
  @HttpCode(202)
  @RequirePermission('ops:write')
  @ApiBody({ schema: schemaRef('ReplayQuarantineBody') })
  @ApiResponse({ status: 202, ...jsonResponse('OperatorActionView', 'Queued or existing idempotent replay action') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:write is required') })
  @ApiResponse({ status: 409, ...problemResponse('idempotency_conflict') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async replay(
    @Param('sequence') rawSequence: string,
    @Headers('idempotency-key') rawKey: unknown,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperatorActionView> {
    const sequence = this.sequence(rawSequence);
    const key = parseIdempotencyKey(rawKey);
    const body = normalizeReplayBody(rawBody);
    return this.admit(key, 'quarantine_replay', body.reason, { sequence }, operationContext(res));
  }

  @Post('search/repairs')
  @HttpCode(202)
  @RequirePermission('ops:write')
  @ApiBody({ schema: schemaRef('StartContentRepairBody') })
  @ApiResponse({ status: 202, ...jsonResponse('OperatorActionView', 'Queued or existing idempotent repair action') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:write is required') })
  @ApiResponse({ status: 409, ...problemResponse('idempotency_conflict') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async repair(
    @Headers('idempotency-key') rawKey: unknown,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperatorActionView> {
    const key = parseIdempotencyKey(rawKey);
    const body = normalizeRepairBody(rawBody);
    return this.admit(key, 'content_repair', body.reason, {
      contentId: body.contentId,
      target: body.target,
    }, operationContext(res));
  }

  @Get('operator-actions/:id')
  @RequirePermission('ops:read')
  @ApiParam(UUID_PARAM)
  @ApiResponse({ status: 200, ...jsonResponse('OperatorActionView', 'Durable operator action state') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 403, ...problemResponse('forbidden; ops:read is required') })
  @ApiResponse({ status: 404, ...problemResponse('operation_not_found') })
  @ApiResponse({ status: 422, ...problemResponse('validation_failed') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable') })
  async actionDetail(@Param('id') id: string): Promise<OperatorActionView> {
    return toOperatorActionView(await this.action(id));
  }

  private async admit(
    id: string,
    kind: 'reindex' | 'quarantine_replay' | 'content_repair',
    reason: string,
    target: OperatorActionTarget,
    context: OperationContext,
  ): Promise<OperatorActionView> {
    const { action } = await dependencyRead(() => this.actions.admit({
      id,
      kind,
      requestFingerprint: operatorRequestFingerprint(kind, reason, target),
      actor: context.actor,
      correlationId: context.correlationId,
      reason,
      target,
    }));
    this.runner.wake();
    return toOperatorActionView(action);
  }

  private async action(id: string) {
    if (!z.uuid().safeParse(id).success) throw validationFailed(['id']);
    const action = await dependencyRead(() => this.actions.get(id));
    if (!action) throw new ApiError('operation_not_found', 'No operator action exists for the given id.');
    return action;
  }

  private sequence(raw: string): number {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw validationFailed(['sequence']);
    return value;
  }

  private async reindexControl(index: 'a' | 'b', runId: string) {
    const rows = await dependencyRead(() => this.control.all());
    const row = rows.find(candidate => candidate.indexAlias === index && candidate.runId === runId);
    if (!row) return null;
    return {
      phase: row.phase,
      snapshotStreamSequence: row.snapshotStreamSequence,
      outboxHighWater: row.outboxHighWater,
      catchUpStreamSequence: row.catchUpStreamSequence,
      importedDocuments: row.importedDocuments,
      expectedDocuments: row.expectedDocuments,
      startedAt: row.startedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      errorCode: row.lastErrorCode,
    };
  }

}
