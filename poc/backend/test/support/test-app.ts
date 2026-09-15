/**
 * M1 test assembly. It exists only under `test/`, is never part of `src/` and
 * therefore never reaches `dist/`: the normal application build contains no
 * identity adapter, no actor header and no admin bypass.
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { pino } from 'pino';
import { AppModule } from '../../src/app.module.js';
import { ApiExceptionFilter, jsonBody, jsonBodyErrors, requestBoundary } from '../../src/http.js';
import type { Actor } from '../../src/identity/actor.js';

export type TestApp = {
  url: string;
  close: () => Promise<void>;
  request: (method: string, path: string, options?: { body?: unknown; actor?: Actor | null; correlationId?: string }) => Promise<{ status: number; body: any; headers: Headers }>;
};

const silent = pino({ level: 'silent' });

/**
 * The actor is injected by this assembly, not read from an untrusted header by
 * the application: the middleware below lives in the test build only.
 */
export async function createTestApp(defaultActor: Actor | null = null): Promise<TestApp> {
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false, abortOnError: false, bodyParser: false });
  app.use(requestBoundary(silent, { blockAdmin: false }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = req.headers['x-test-actor'];
    if (typeof header === 'string' && header.length > 0) {
      res.locals.actor = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Actor;
    } else if (header === undefined && defaultActor) {
      res.locals.actor = defaultActor;
    }
    next();
  });
  app.use(jsonBody());
  app.use(jsonBodyErrors());
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  return {
    url,
    close: () => app.close(),
    async request(method, path, options = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.actor !== undefined) {
        headers['x-test-actor'] = options.actor === null
          ? ''
          : Buffer.from(JSON.stringify(options.actor), 'utf8').toString('base64');
      }
      if (options.correlationId) headers['x-correlation-id'] = options.correlationId;
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(8000) };
      if (options.body !== undefined) {
        init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      }
      const response = await fetch(url + path, init);
      const text = await response.text();
      let body: unknown = null;
      try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text; }
      return { status: response.status, body, headers: response.headers };
    },
  };
}
