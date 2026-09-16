import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(scriptDir, '../../contracts/backend.openapi.json');
const generatedPath = resolve(scriptDir, '../src/api/generated/backend.ts');

const snapshot = await readFile(snapshotPath);
const expected = `${COMMENT_HEADER}${astToString(await openapiTS(snapshot, { silent: true }))}`;
const current = await readFile(generatedPath, 'utf8').catch(() => null);

if (current !== expected) {
  process.stderr.write('Frontend API type drift: run npm run contracts:generate.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`${generatedPath}\n`);
}
