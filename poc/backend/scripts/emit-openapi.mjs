import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDir, '../../contracts/backend.openapi.json');

// Contract generation must be deterministic and must not reach infrastructure.
// A dedicated empty env file also isolates it from a developer's local .env.
process.env.ENV_FILE = resolve(scriptDir, 'openapi.env');
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://openapi:openapi@127.0.0.1:5432/openapi_contract';
process.env.FEATURE_IDENTITY = 'off';
process.env.FEATURE_OUTBOX_RELAY = 'off';
process.env.FEATURE_SEARCH = 'off';
process.env.FEATURE_MEDIA = 'off';

const { AppModule } = await import('../dist/app.module.js');
const { createOpenApiDocument } = await import('../dist/openapi-document.js');

const app = await NestFactory.create(AppModule, {
  logger: false,
  abortOnError: false,
  bodyParser: false,
});

try {
  const document = createOpenApiDocument(app);
  const output = `${JSON.stringify(document, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8').catch(() => null);
    if (current !== output) {
      throw new Error('OpenAPI snapshot drift: run npm run openapi:emit.');
    }
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, 'utf8');
  }
  process.stdout.write(`${outputPath}\n`);
} finally {
  await app.close();
}
