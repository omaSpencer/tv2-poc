import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter, jsonBody, jsonBodyErrors, requestBoundary } from './http.js';
import { disabledIntegrationNames, type AppConfig } from './config.js';
import { createOpenApiDocument } from './openapi-document.js';
import { publicRateLimit } from './rate-limit.js';
import { identityBoundary } from './identity/identity.boundary.js';
import { TokenVerifier } from './identity/token-verifier.js';
import { startupFailure } from './startup-failure.js';
import { APP_LOGGER } from './observability/logger.js';
import type { Logger } from 'pino';

async function bootstrap() {
  // Dynamic import keeps config/module evaluation inside the sanitized error boundary.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false, bodyParser: false });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const log = app.get<Logger>(APP_LOGGER);
  const identityOn = config.getOrThrow<string>('FEATURE_IDENTITY') === 'on';
  app.use(requestBoundary(log, { blockAdmin: !identityOn }));
  // BE-F1 S1: the public edge limit runs before token verification, so a flood
  // on a public route cannot spend JWKS or database work.
  if (config.getOrThrow<string>('RATE_LIMIT_PUBLIC') === 'on') {
    app.use(publicRateLimit({
      max: config.getOrThrow<number>('RATE_LIMIT_PUBLIC_MAX'),
      windowMs: config.getOrThrow<number>('RATE_LIMIT_PUBLIC_WINDOW_MS'),
      trustedProxyHops: config.getOrThrow<number>('RATE_LIMIT_TRUSTED_PROXY_HOPS'),
    }));
  }
  if (identityOn) {
    app.use(identityBoundary(app.get(TokenVerifier), log));
  }
  app.use(jsonBody());
  app.use(jsonBodyErrors());
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = createOpenApiDocument(app);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: '/docs-json' });
  try {
    await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('HOST'));
  } catch (error) { await app.close(); throw error; }
  // Independent of configured log level: the smoke parent learns the actual bound port.
  process.stdout.write(JSON.stringify({ event: 'listening', url: await app.getUrl() }) + '\n');
  const flags = {
    FEATURE_IDENTITY: config.getOrThrow<AppConfig['FEATURE_IDENTITY']>('FEATURE_IDENTITY'),
    FEATURE_OUTBOX_RELAY: config.getOrThrow<AppConfig['FEATURE_OUTBOX_RELAY']>('FEATURE_OUTBOX_RELAY'),
    FEATURE_SEARCH: config.getOrThrow<AppConfig['FEATURE_SEARCH']>('FEATURE_SEARCH'),
    FEATURE_MEDIA: config.getOrThrow<AppConfig['FEATURE_MEDIA']>('FEATURE_MEDIA'),
  };
  log.info({ event: 'integrations_disabled', integrations: disabledIntegrationNames(flags) });
}

bootstrap().catch(error => {
  process.stderr.write(JSON.stringify(startupFailure(error)) + '\n');
  process.exitCode = 1;
});
