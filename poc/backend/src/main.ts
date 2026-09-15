import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { pino } from 'pino';
import { ApiExceptionFilter, requestBoundary } from './http.js';
import { ConfigurationError } from './config.js';

async function bootstrap() {
  // Dynamic import keeps config/module evaluation inside the sanitized error boundary.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const log = pino({ level: config.getOrThrow<string>('LOG_LEVEL') });
  app.use(requestBoundary(log));
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('IndaPlay PoC backend').setVersion('0.0.0').build());
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: '/docs-json' });
  try {
    await app.listen(config.getOrThrow<number>('PORT'), '127.0.0.1');
  } catch (error) { await app.close(); throw error; }
  // Independent of configured log level: the smoke parent learns the actual bound port.
  process.stdout.write(JSON.stringify({ event: 'listening', url: await app.getUrl() }) + '\n');
  log.info({ event: 'integrations_disabled', integrations: ['identity', 'outbox', 'search', 'media'] });
}

bootstrap().catch(error => {
  const failure = error instanceof ConfigurationError
    ? { event: 'startup_failed', code: 'invalid_configuration', keys: error.keys }
    : { event: 'startup_failed', code: 'bootstrap_failed' };
  process.stderr.write(JSON.stringify(failure) + '\n');
  process.exitCode = 1;
});
