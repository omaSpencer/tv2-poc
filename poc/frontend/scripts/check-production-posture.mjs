import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentSecurityPolicy, oidcOriginFromIssuer } from '../src/config/securityHeaders.ts';

const distRoot = fileURLToPath(new URL('../dist', import.meta.url));
const headersPath = process.argv.includes('--headers')
  ? process.argv[process.argv.indexOf('--headers') + 1]
  : fileURLToPath(new URL('../.generated/security-headers.conf', import.meta.url));

function walk(directory, files = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      walk(path, files);
      continue;
    }
    if (extname(name) === '.js') files.push(path);
  }
  return files;
}

const forbiddenOrigins = ['127.0.0.1:3000', 'localhost:3000'];
for (const file of walk(distRoot)) {
  const text = readFileSync(file, 'utf8');
  for (const needle of forbiddenOrigins) {
    if (text.includes(needle)) {
      throw new Error(`A production bundle localhost backend fallbacket tartalmaz (${needle}): ${file}`);
    }
  }
}

let headers;
try {
  headers = readFileSync(headersPath, 'utf8');
} catch {
  throw new Error(`Hiányzik a generated nginx security header fájl: ${headersPath}`);
}

if (/unsafe-eval/.test(headers)) {
  throw new Error('A CSP unsafe-eval-t enged.');
}
if (/script-src[^;]*\*/.test(headers)) {
  throw new Error('A CSP korlátlan script forrást enged.');
}
if (!/frame-ancestors 'none'/.test(headers)) {
  throw new Error("A CSP nem tartalmazza a frame-ancestors 'none' szabályt.");
}

const oidcOrigin = oidcOriginFromIssuer(process.env.VITE_OIDC_ISSUER_URL);
const expectedCsp = buildContentSecurityPolicy(oidcOrigin);
if (!headers.includes(expectedCsp)) {
  throw new Error('A generated nginx CSP nem egyezik a buildelt OIDC origin szerződéssel.');
}
if (oidcOrigin && (!headers.includes(`connect-src 'self' ${oidcOrigin}`) || !headers.includes(`frame-src 'self' ${oidcOrigin}`))) {
  throw new Error('A CSP connect-src/frame-src nem tartalmazza a konfigurált OIDC origint.');
}

console.log(JSON.stringify({
  event: 'production_posture',
  docsHref: '/api/docs',
  oidcOrigin,
  headersPath,
}));
