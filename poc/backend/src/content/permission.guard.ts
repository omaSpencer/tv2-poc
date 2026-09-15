/**
 * Route → permission enforcement (M0-14 contract). In the normal application
 * `/admin` never reaches a guard: the request boundary answers 503 while
 * identity is off. M2 swaps the actor source for a verified token; the rules
 * below stay put.
 */
import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ApiError } from '../contracts/errors.js';
import type { Permission } from '../contracts/permissions.js';
import { actorPermissions } from '../identity/actor.js';

export const REQUIRED_PERMISSION = 'poc:required-permission';
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const res = context.switchToHttp().getResponse<Response>();
    const actor = res.locals.actor;
    if (!actor) throw new ApiError('unauthenticated', 'No verified identity is present on the request.');
    if (!actorPermissions(actor).has(required)) {
      throw new ApiError('forbidden', 'The identity lacks the permission required for this operation.');
    }
    return true;
  }
}
