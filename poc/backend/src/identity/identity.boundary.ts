/**
 * Identity boundary (M2-05). Runs after requestBoundary so correlation IDs are set.
 * Present-but-invalid Authorization fails every route with 401, including public ones.
 */
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';
import { ApiError, ERROR_CODES } from '../contracts/errors.js';
import { problem } from '../http.js';
import type { TokenVerifier } from './token-verifier.js';

export function identityBoundary(verifier: TokenVerifier, log: Logger) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (header === undefined) {
      next();
      return;
    }
    const correlationId = res.locals.correlationId ?? 'unknown';
    try {
      const verified = await verifier.verifyAccessToken(header);
      res.locals.actor = verified.actor;
      res.locals.tokenExpiresAt = verified.expiresAt;
      next();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'unauthenticated') {
          res.setHeader('WWW-Authenticate', 'Bearer');
        }
        res
          .status(error.status)
          .type('application/problem+json')
          .json(problem(error.code, correlationId, error.detail, req.path, error.extras));
        return;
      }
      log.warn({ event: 'token_rejected', reason: 'unexpected' });
      res
        .status(ERROR_CODES.internal_error)
        .type('application/problem+json')
        .json(problem('internal_error', correlationId, 'The request could not be completed.', req.path));
    }
  };
}
