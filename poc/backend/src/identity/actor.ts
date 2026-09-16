/**
 * Identity boundary. M1 never derives an actor from a request body or a header
 * in the normal application: `/admin` is blocked while FEATURE_IDENTITY is off.
 * A test assembly injects an actor explicitly; M2 replaces that with a verified
 * Authentik token. There is no `system` fallback for a missing actor.
 */
import type { Response } from 'express';
import { ApiError } from '../contracts/errors.js';
import { permissionsForRoles, type Permission } from '../contracts/permissions.js';

export type Actor = { readonly sub: string; readonly roles: readonly string[] };
export type OperationContext = { readonly actor: Actor; readonly correlationId: string };

declare module 'express-serve-static-core' {
  interface Locals {
    correlationId?: string;
    actor?: Actor;
    tokenExpiresAt?: Date;
  }
}

export function actorPermissions(actor: Actor): Set<Permission> {
  return permissionsForRoles(actor.roles);
}

export function operationContext(res: Response): OperationContext {
  const actor = res.locals.actor;
  if (!actor || typeof actor.sub !== 'string' || actor.sub.trim().length === 0) {
    throw new ApiError('unauthenticated', 'No verified identity is present on the request.');
  }
  const correlationId = res.locals.correlationId;
  if (typeof correlationId !== 'string') {
    throw new ApiError('internal_error', 'The request boundary did not assign a correlation id.');
  }
  return { actor, correlationId };
}
