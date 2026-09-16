#!/usr/bin/env node
/**
 * Authorization Code + PKCE login against the PoC Authentik application.
 *
 *   node scripts/authentik-login.mjs <poc-viewer|poc-editor|poc-publisher>
 *
 * Requires AUTHENTIK_PUBLIC_URL, AUTHENTIK_POC_USER_PASSWORD, and a reachable
 * Authentik instance (E01–E05). Prints a secret-free token summary only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const identity = process.argv[2];
const allowed = new Set(['poc-viewer', 'poc-editor', 'poc-publisher']);
if (!allowed.has(identity)) {
  process.stderr.write(JSON.stringify({
    event: 'login_failed',
    code: 'invalid_identity',
    detail: 'Usage: node scripts/authentik-login.mjs <poc-viewer|poc-editor|poc-publisher>',
  }) + '\n');
  process.exitCode = 1;
  process.exit();
}

const publicUrl = (process.env.AUTHENTIK_PUBLIC_URL || '').replace(/\/$/, '');
const password = process.env.AUTHENTIK_POC_USER_PASSWORD;
const clientId = process.env.OIDC_CLIENT_ID || 'poc-backend';
const redirectUri = process.env.OIDC_REDIRECT_URI || 'http://127.0.0.1:8765/callback';
const audience = process.env.OIDC_AUDIENCE || 'poc-backend-api';

if (!publicUrl || !password) {
  process.stderr.write(JSON.stringify({
    event: 'login_failed',
    code: 'missing_configuration',
    detail: 'AUTHENTIK_PUBLIC_URL and AUTHENTIK_POC_USER_PASSWORD are required.',
    pending: ['E02', 'E03', 'E04', 'E05'],
  }) + '\n');
  process.exitCode = 2;
  process.exit();
}

const issuer = `${publicUrl}/application/o/poc-backend`;
const discoveryUrl = `${issuer}/.well-known/openid-configuration`;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

let discovery;
try {
  const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`discovery HTTP ${response.status}`);
  discovery = await response.json();
} catch (error) {
  process.stderr.write(JSON.stringify({
    event: 'login_failed',
    code: 'idp_unavailable',
    detail: 'Authentik discovery is unreachable; L2 remains pending.',
    pending: ['E01', 'E02'],
    reason: error.message,
  }) + '\n');
  process.exitCode = 3;
  process.exit();
}

process.stdout.write(JSON.stringify({
  event: 'login_pending_interactive',
  identity,
  issuer: discovery.issuer,
  audience,
  clientId,
  authorizationEndpoint: discovery.authorization_endpoint,
  tokenEndpoint: discovery.token_endpoint,
  jwksUri: discovery.jwks_uri,
  redirectUri,
  note: 'Interactive browser login is required for Authorization Code + PKCE. Use demo:m2 once tokens can be obtained.',
  pkce: pkce(),
}) + '\n');

// Probe that the redirect port is free for a future interactive helper.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(8765, '127.0.0.1', resolve);
});
probe.close();
process.exitCode = 0;
