import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNginxSecurityHeaders } from '../src/config/securityHeaders.ts';

const outFlag = process.argv.indexOf('--out');
const outPath = outFlag >= 0
  ? process.argv[outFlag + 1]
  : fileURLToPath(new URL('../.generated/security-headers.conf', import.meta.url));

if (!outPath) {
  throw new Error('A --out útvonal hiányzik.');
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, renderNginxSecurityHeaders(process.env), 'utf8');
console.log(JSON.stringify({ event: 'nginx_security_headers', path: outPath }));
