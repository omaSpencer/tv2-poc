/**
 * One place builds the published OpenAPI document, so the served `/docs-json`,
 * the smoke gate and the contract tests all judge the same thing.
 *
 * Nest's decorators describe the operations; `components.schemas` is merged in
 * from the Zod-derived projections (`contracts/openapi.ts`) because the routes
 * intentionally take `@Body() body: unknown` — the normalisation path is the
 * only validator, and a DTO class here would be a second, divergent one.
 */
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { OPENAPI_SCHEMAS } from './contracts/openapi.js';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('IndaPlay PoC backend')
    .setVersion('0.0.0')
    .setDescription(
      'Errors are application/problem+json documents with a stable `code`. '
      + 'Admin routes require a verified bearer token once FEATURE_IDENTITY is on.',
    )
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build());
  document.components = document.components ?? {};
  document.components.schemas = {
    ...document.components.schemas,
    ...OPENAPI_SCHEMAS,
  };
  return document;
}
