/**
 * D-M0-09 – request boundary and the single error-shaping point.
 *
 * Business and API errors leave as application/problem+json with a stable code.
 * Health responses keep the Terminus shape and are the documented exception.
 */
import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Logger } from 'pino';
import { ApiError, ERROR_CODES, type ErrorCode, type ProblemExtras } from './contracts/errors.js';

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export type ProblemDocument = {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  instance: string;
  correlationId: string;
} & ProblemExtras;

export function problem(
  code: ErrorCode,
  correlationId: string,
  detail = 'The request could not be completed.',
  instance = '',
  extras: ProblemExtras = {},
): ProblemDocument {
  return {
    type: `urn:indaplay:poc:error:${code}`,
    title: code.replaceAll('_', ' '),
    status: ERROR_CODES[code],
    code,
    detail,
    instance,
    correlationId,
    ...extras,
  };
}

export type BoundaryOptions = {
  /** M2 replaces this with a real identity check; until then /admin is closed. */
  blockAdmin: boolean;
};

export function requestBoundary(log: Logger, options: BoundaryOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const candidate = req.headers['x-correlation-id'];
    const id = typeof candidate === 'string' && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
    res.locals.correlationId = id;
    res.setHeader('X-Correlation-Id', id);
    res.on('finish', () => {
      // No URL, request body, headers, errors or credentials enter the log.
      log.info({ event: 'http_request', correlationId: id, method: req.method, status: res.statusCode });
    });
    const path = req.path.toLowerCase();
    if (options.blockAdmin && (path === '/admin' || path.startsWith('/admin/'))) {
      res
        .status(503)
        .type('application/problem+json')
        .json(problem('dependency_unavailable', id, 'Identity verification is not configured.', req.path));
      return;
    }
    next();
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const req = context.getRequest<Request>();
    const res = context.getResponse<Response>();
    const correlationId = res.locals.correlationId ?? randomUUID();

    if (exception instanceof ApiError) {
      if (exception.code === 'unauthenticated') {
        res.setHeader('WWW-Authenticate', 'Bearer');
      }
      this.send(res, problem(exception.code, correlationId, exception.detail, req.path, exception.extras));
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Health keeps its own contract; the filter must not reshape it.
      if (req.path.toLowerCase() === '/health/ready' && status === 503) {
        res.status(503).json(exception.getResponse());
        return;
      }
      const code: ErrorCode =
        status === 404 ? 'not_found'
        : status === 401 ? 'unauthenticated'
        : status === 403 ? 'forbidden'
        : status === 400 ? 'invalid_request'
        // BE-F1 S1: a 429 raised anywhere in the stack keeps the stable
        // rate_limited code; it must never fall through to internal_error.
        : status === 429 ? 'rate_limited'
        : status === 503 ? 'dependency_unavailable'
        : 'internal_error';
      this.send(res, problem(code, correlationId, 'The request could not be completed.', req.path));
      return;
    }
    // Nothing from an unexpected failure reaches the client beyond the code.
    this.send(res, problem('internal_error', correlationId, 'The request could not be completed.', req.path));
  }

  private send(res: Response, document: ProblemDocument): void {
    res.status(document.status).type('application/problem+json').json(document);
  }
}

/**
 * The JSON body parser is registered here rather than by the platform default,
 * so a malformed body produces the documented `invalid_json` problem instead of
 * a generic framework error. The size limit is explicit for the same reason.
 */
export const JSON_BODY_LIMIT = '256kb';

export function jsonBody() {
  return express.json({ limit: JSON_BODY_LIMIT });
}

export function jsonBodyErrors() {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    const candidate = error as { type?: unknown } | null;
    if (candidate?.type !== 'entity.parse.failed' && candidate?.type !== 'entity.too.large') {
      next(error);
      return;
    }
    const correlationId = res.locals.correlationId ?? randomUUID();
    const code: ErrorCode = candidate.type === 'entity.parse.failed' ? 'invalid_json' : 'payload_too_large';
    const detail = code === 'invalid_json'
      ? 'The request body is not valid JSON.'
      : 'The request body exceeds the accepted size.';
    res.status(ERROR_CODES[code]).type('application/problem+json').json(problem(code, correlationId, detail, req.path));
  };
}
