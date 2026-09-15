import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';

export function problem(status: number, code: string, correlationId: string) {
  return {
    type: `urn:indaplay:poc:error:${code}`, title: code.replaceAll('_', ' '),
    status, code, detail: 'The request could not be completed.', correlationId,
  };
}

export function requestBoundary(log: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const candidate = req.headers['x-correlation-id'];
    const id = typeof candidate === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(candidate)
      ? candidate : randomUUID();
    res.locals.correlationId = id;
    res.setHeader('X-Correlation-Id', id);
    res.on('finish', () => {
      // No URL, request body, headers, errors or credentials enter the log.
      log.info({ event: 'http_request', correlationId: id, method: req.method, status: res.statusCode });
    });
    const path = req.path.toLowerCase();
    if (path === '/admin' || path.startsWith('/admin/')) {
      res.status(503).type('application/problem+json').json(problem(503, 'dependency_unavailable', id));
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
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (req.path.toLowerCase() === '/health/ready' && exception instanceof HttpException && status === 503) {
      res.status(503).json(exception.getResponse());
      return;
    }
    const code = status === 404 ? 'not_found' : status === 400 ? 'invalid_request' : 'internal_error';
    res.status(status).type('application/problem+json').json(problem(status, code, res.locals.correlationId));
  }
}
