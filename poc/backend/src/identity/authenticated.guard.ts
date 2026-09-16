/**
 * Requires a verified actor without a specific permission (for GET /me).
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../contracts/errors.js';

@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const res = context.switchToHttp().getResponse<Response>();
    if (!res.locals.actor) {
      throw new ApiError('unauthenticated', 'No verified identity is present on the request.');
    }
    return true;
  }
}
