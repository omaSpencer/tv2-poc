#!/usr/bin/env node
/**
 * M0-13 – publish the v1 event JSON Schema generated from the Zod contract, so
 * the schema file, the runtime validator and the TypeScript type stay one
 * source of truth. Run after `npm run build`.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contentEventV1JsonSchema, CONTENT_EVENT_V1_EXAMPLES, contentEventV1Schema } from '../dist/contracts/events.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = contentEventV1JsonSchema();

for (const example of CONTENT_EVENT_V1_EXAMPLES) {
  const result = contentEventV1Schema.safeParse(example);
  if (!result.success) {
    process.stderr.write(`${JSON.stringify({ event: 'contract_example_invalid' })}\n`);
    process.exit(1);
  }
}

const document = {
  $id: 'urn:indaplay:poc:events:content-changed:v1',
  title: 'IndaPlay PoC content change event, schema version 1',
  ...schema,
  examples: CONTENT_EVENT_V1_EXAMPLES,
};

await writeFile(join(root, 'src/contracts/events.v1.schema.json'), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ event: 'contracts_emitted', file: 'src/contracts/events.v1.schema.json' })}\n`);
