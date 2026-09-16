/**
 * GET /me – verified identity summary (M2-07). No e-mail, groups or raw claims.
 */
import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiError } from '../contracts/errors.js';
import { jsonResponse, problemResponse } from '../contracts/openapi.js';
import { PERMISSIONS, type Permission } from '../contracts/permissions.js';
import { actorPermissions } from './actor.js';
import { AuthenticatedGuard } from './authenticated.guard.js';

export type MeView = {
  sub: string;
  roles: string[];
  permissions: Permission[];
  expiresAt: string;
};

@ApiTags('identity')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthenticatedGuard)
export class MeController {
  @Get('me')
  @ApiOperation({ summary: 'Current verified identity' })
  @ApiResponse({ status: 200, ...jsonResponse('MeView', 'sub, roles, permissions, expiresAt') })
  @ApiResponse({ status: 401, ...problemResponse('unauthenticated') })
  @ApiResponse({ status: 503, ...problemResponse('dependency_unavailable when the identity provider is down') })
  me(@Res({ passthrough: true }) res: Response): MeView {
    const actor = res.locals.actor;
    if (!actor) throw new ApiError('unauthenticated', 'No verified identity is present on the request.');
    const expiresAt = res.locals.tokenExpiresAt;
    if (!(expiresAt instanceof Date)) {
      throw new ApiError('internal_error', 'The identity boundary did not record token expiry.');
    }
    const granted = actorPermissions(actor);
    return {
      sub: actor.sub,
      roles: [...actor.roles],
      permissions: PERMISSIONS.filter(permission => granted.has(permission)),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
