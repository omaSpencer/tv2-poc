import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { pino } from 'pino';
import { ApiExceptionFilter, jsonBody, jsonBodyErrors, requestBoundary } from './http.js';
import { ConfigurationError, disabledIntegrationNames, type AppConfig } from './config.js';

async function bootstrap() {
  // Dynamic import keeps config/module evaluation inside the sanitized error boundary.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false, bodyParser: false });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const log = pino({ level: config.getOrThrow<string>('LOG_LEVEL') });
  // Identity is off until M2, so the whole /admin prefix answers 503.
  app.use(requestBoundary(log, { blockAdmin: config.getOrThrow<string>('FEATURE_IDENTITY') !== 'on' }));
  app.use(jsonBody());
  app.use(jsonBodyErrors());
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('IndaPlay PoC backend').setVersion('0.0.0').build());
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: '/docs-json' });
  try {
    await app.listen(config.getOrThrow<number>('PORT'), '127.0.0.1');
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
  const failure = error instanceof ConfigurationError
    ? { event: 'startup_failed', code: 'invalid_configuration', keys: error.keys }
    : { event: 'startup_failed', code: 'bootstrap_failed' };
  process.stderr.write(JSON.stringify(failure) + '\n');
  process.exitCode = 1;
});
