/**
 * Identity-on test assembly: real identityBoundary + TokenVerifier against a
 * mock OIDC issuer. Actor injection via x-test-actor is intentionally absent.
 */
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { pino } from 'pino';
import { ApiExceptionFilter, jsonBody, jsonBodyErrors, requestBoundary } from '../../src/http.js';
import { identityBoundary } from '../../src/identity/identity.boundary.js';
import { TokenVerifier, type TokenVerifierOptions } from '../../src/identity/token-verifier.js';
import { OidcDiscovery } from '../../src/identity/oidc.js';

export type IdentityApp = {
  url: string;
  close: () => Promise<void>;
  verifier: TokenVerifier;
  discovery: OidcDiscovery;
  request: (
    method: string,
    path: string,
    options?: {
      body?: unknown;
      token?: string | null;
      authorization?: string;
      correlationId?: string;
      headers?: Record<string, string>;
    },
  ) => Promise<{ status: number; body: any; headers: Headers }>;
};

const silent = pino({ level: 'silent' });

export type IdentityAppOptions = {
  issuer: string;
  audience: string;
  jwksUri?: string;
  clockToleranceS?: number;
  httpTimeoutMs?: number;
  verifierOptions?: TokenVerifierOptions;
};

/** Apply OIDC env before Nest evaluates ConfigModule.validate. */
export function applyIdentityEnv(options: IdentityAppOptions, databaseUrl: string): void {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.LOG_LEVEL = 'silent';
  process.env.DATABASE_URL = databaseUrl;
  process.env.FEATURE_IDENTITY = 'on';
  process.env.FEATURE_OUTBOX_RELAY = 'off';
  process.env.FEATURE_SEARCH = 'off';
  process.env.FEATURE_MEDIA = 'off';
  process.env.OIDC_ISSUER_URL = options.issuer;
  process.env.OIDC_AUDIENCE = options.audience;
  if (options.jwksUri) process.env.OIDC_JWKS_URI = options.jwksUri;
  else delete process.env.OIDC_JWKS_URI;
  process.env.OIDC_CLOCK_TOLERANCE_S = String(options.clockToleranceS ?? 30);
  process.env.OIDC_HTTP_TIMEOUT_MS = String(options.httpTimeoutMs ?? 2000);
}

export async function createIdentityApp(options: IdentityAppOptions): Promise<IdentityApp> {
  // Import only after applyIdentityEnv(): ConfigModule.forRoot validates while
  // AppModule is evaluated, so a static import would capture the developer's
  // runtime .env before this isolated harness can install its mock issuer.
  const { AppModule } = await import('../../src/app.module.js');
  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
    bodyParser: false,
  });
  // AppModule is cached by ESM after the first harness instance. Nested
  // discovery/JWKS cases still need their own dynamic issuer values.
  const config = app.get(ConfigService);
  config.set('OIDC_ISSUER_URL', options.issuer);
  config.set('OIDC_AUDIENCE', options.audience);
  if (options.jwksUri !== undefined) config.set('OIDC_JWKS_URI', options.jwksUri);
  config.set('OIDC_CLOCK_TOLERANCE_S', options.clockToleranceS ?? 30);
  config.set('OIDC_HTTP_TIMEOUT_MS', options.httpTimeoutMs ?? 2000);
  const verifier = app.get(TokenVerifier);
  if (options.verifierOptions) verifier.configureForTest(options.verifierOptions);
  const discovery = app.get(OidcDiscovery);
  app.use(requestBoundary(silent, { blockAdmin: false }));
  app.use(identityBoundary(verifier, silent));
  app.use(jsonBody());
  app.use(jsonBodyErrors());
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  return {
    url,
    verifier,
    discovery,
    close: () => app.close(),
    async request(method, path, opts = {}) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...opts.headers,
      };
      if (opts.authorization !== undefined) {
        headers.authorization = opts.authorization;
      } else if (opts.token) {
        headers.authorization = `Bearer ${opts.token}`;
      } else if (opts.token === null) {
        // Explicitly omit Authorization.
      }
      if (opts.correlationId) headers['x-correlation-id'] = opts.correlationId;
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(8000) };
      if (opts.body !== undefined) {
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }
      const response = await fetch(url + path, init);
      const text = await response.text();
      let body: unknown = null;
      try { body = text.length > 0 ? JSON.parse(text) : null; } catch { body = text; }
      return { status: response.status, body, headers: response.headers };
    },
  };
}
