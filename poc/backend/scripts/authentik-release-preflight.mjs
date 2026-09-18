#!/usr/bin/env node
/**
 * Fail-closed release preflight for the real Authentik provider. This checks
 * discovery, JWKS, provider lifetime/redirect policy and the three test users.
 * It never prints credentials or token material.
 */

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
};

const normalizeUrl = (value) => value.replace(/\/+$/, '');

async function json(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json();
}

try {
  const publicUrl = normalizeUrl(required('AUTHENTIK_PUBLIC_URL'));
  const bootstrapToken = required('AUTHENTIK_BOOTSTRAP_TOKEN');
  const configuredIssuer = normalizeUrl(required('OIDC_ISSUER_URL'));
  const audience = required('OIDC_AUDIENCE');
  if (audience !== 'poc-backend-api') throw new Error('audience_contract_mismatch');

  const discovery = await json(`${configuredIssuer}/.well-known/openid-configuration`);
  if (normalizeUrl(discovery.issuer ?? '') !== configuredIssuer) throw new Error('issuer_mismatch');
  if (typeof discovery.jwks_uri !== 'string') throw new Error('jwks_uri_missing');
  const jwks = await json(discovery.jwks_uri);
  if (!Array.isArray(jwks.keys) || !jwks.keys.some(key => key?.kty === 'RSA')) {
    throw new Error('rsa_signing_key_missing');
  }

  const apiHeaders = { authorization: `Bearer ${bootstrapToken}`, accept: 'application/json' };
  const providers = await json(`${publicUrl}/api/v3/providers/oauth2/?name=PoC%20Backend`, { headers: apiHeaders });
  if (!Array.isArray(providers.results) || providers.results.length !== 1) {
    throw new Error('provider_not_unique');
  }
  const provider = providers.results[0];
  if (provider.client_type !== 'public' || provider.client_id !== 'poc-backend') {
    throw new Error('public_client_contract_mismatch');
  }
  if (provider.issuer_mode !== 'per_provider') throw new Error('issuer_mode_mismatch');
  if (provider.access_token_validity !== 'minutes=5') throw new Error('access_lifetime_mismatch');
  if (provider.refresh_token_validity !== 'hours=1') throw new Error('refresh_lifetime_mismatch');

  const expectedRedirects = [
    'http://127.0.0.1:8765/callback',
    'http://127.0.0.1:5173/auth/callback',
    'http://127.0.0.1:5173/auth/silent-callback',
    'http://127.0.0.1:5173/login',
  ].sort();
  const redirects = Array.isArray(provider.redirect_uris) ? provider.redirect_uris : [];
  if (redirects.some(redirect => redirect?.matching_mode !== 'strict')) {
    throw new Error('non_strict_redirect');
  }
  const actualRedirects = redirects.map(redirect => redirect?.url).sort();
  if (JSON.stringify(actualRedirects) !== JSON.stringify(expectedRedirects)) {
    throw new Error('redirect_contract_mismatch');
  }

  for (const username of ['poc-viewer', 'poc-editor', 'poc-publisher']) {
    const users = await json(`${publicUrl}/api/v3/core/users/?username=${encodeURIComponent(username)}`, {
      headers: apiHeaders,
    });
    const user = users.results?.find(candidate => candidate.username === username);
    const groups = user?.groups_obj?.map(group => group.name) ?? [];
    if (!user?.is_active || !groups.includes(username)) throw new Error(`identity_contract_mismatch_${username}`);
  }

  process.stdout.write(JSON.stringify({
    event: 'authentik_release_preflight',
    status: 'pass',
    issuer: discovery.issuer,
    jwks: 'rsa_available',
    audience,
    accessTokenValidity: provider.access_token_validity,
    refreshTokenValidity: provider.refresh_token_validity,
    redirects: expectedRedirects.length,
    identities: 3,
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    event: 'authentik_release_preflight',
    status: 'fail',
    code: error instanceof Error ? error.message : 'unknown',
  }) + '\n');
  process.exitCode = 1;
}
