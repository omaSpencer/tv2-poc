/**
 * Local RSA keypair + HTTP discovery/JWKS mock for M2 L1 tests.
 * Lives only under `test/`; never imported from `src/`.
 */
import { createServer, type Server } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, type JWK, type KeyLike } from 'jose';

export const TEST_AUDIENCE = 'poc-backend-api';
export const TEST_CLIENT_ID = 'poc-backend';

export type OidcMock = {
  issuer: string;
  jwksUri: string;
  discoveryUrl: string;
  audience: string;
  kid: string;
  jwksHits: () => number;
  discoveryHits: () => number;
  setKeys: (keys: JWK[]) => void;
  stopJwks: () => void;
  /** Answer JWKS with an HTTP error status (R08) instead of an empty key set. */
  failJwksWithStatus: (status: number) => void;
  /** Answer JWKS with HTTP 200 and a body that is not JSON (R08). */
  failJwksWithGarbage: () => void;
  resumeJwks: () => void;
  close: () => Promise<void>;
  signAccessToken: (claims: {
    sub: string;
    groups?: string[];
    aud?: string | string[];
    iss?: string;
    expOffsetSec?: number;
    exp?: number;
    /** `null` omits the claim entirely; omitted means "now". */
    iat?: number | null;
    nbf?: number;
    kid?: string;
    extra?: Record<string, unknown>;
  }) => Promise<string>;
  /** Sign with a different RSA key while advertising `kid` of the published key. */
  signWithForeignKey: (claims: { sub: string; groups?: string[]; kid?: string }) => Promise<string>;
  publicJwk: () => JWK;
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP listen address');
  return address.port;
}

export async function createOidcMock(options?: {
  issuerPath?: string;
  issuerMismatch?: string;
}): Promise<OidcMock> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const foreign = await generateKeyPair('RS256', { extractable: true });
  const kid = 'test-key-1';
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  let keys: JWK[] = [jwk];
  let jwksHits = 0;
  let discoveryHits = 0;
  let jwksDown = false;
  let jwksStatus: number | null = null;
  let jwksGarbage = false;
  let issuerOverride: string | null = options?.issuerMismatch ?? null;

  const server = createServer((req, res) => {
    const path = req.url?.split('?')[0] ?? '';
    if (path === '/.well-known/openid-configuration' || path.endsWith('/.well-known/openid-configuration')) {
      discoveryHits += 1;
      const body = {
        issuer: issuerOverride ?? issuer,
        jwks_uri: jwksUri,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    if (path === '/jwks' || path.endsWith('/jwks')) {
      jwksHits += 1;
      if (jwksStatus !== null) {
        res.writeHead(jwksStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'jwks unavailable' }));
        return;
      }
      if (jwksGarbage) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('<html>not json</html>');
        return;
      }
      if (jwksDown) {
        // Empty key set: cached keys still verify via jose's local cache; unknown
        // kids become JWKSNoMatchingKey → 401 (M2-T15).
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const pathPrefix = options?.issuerPath ?? '/application/o/poc-backend';
  const issuer = `${base}${pathPrefix}/`;
  const jwksUri = `${base}${pathPrefix}/jwks`;
  // Remount discovery under the issuer path by rewriting — the OidcDiscovery
  // client requests `${issuer}/.well-known/openid-configuration` after stripping
  // a trailing slash, i.e. `${base}${pathPrefix}/.well-known/openid-configuration`.
  // Our handler already accepts any path ending with that suffix. JWKS is at
  // `${base}${pathPrefix}/jwks` which also matches.

  async function signAccessToken(claims: {
    sub: string;
    groups?: string[] | null;
    aud?: string | string[] | null;
    iss?: string;
    expOffsetSec?: number;
    exp?: number;
    iat?: number | null;
    nbf?: number;
    kid?: string;
    key?: KeyLike;
    extra?: Record<string, unknown>;
  }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const exp = claims.exp ?? now + (claims.expOffsetSec ?? 300);
    const payload: Record<string, unknown> = { ...claims.extra };
    if (claims.groups !== null) {
      payload.groups = claims.groups ?? [];
    }
    let builder = new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: claims.kid ?? kid })
      .setSubject(claims.sub)
      .setIssuer(claims.iss ?? issuer)
      .setExpirationTime(exp);
    if (claims.iat !== null) builder = builder.setIssuedAt(claims.iat ?? now);
    if (claims.aud !== null) {
      builder = builder.setAudience(claims.aud === undefined ? TEST_AUDIENCE : claims.aud);
    }
    if (claims.nbf !== undefined) builder = builder.setNotBefore(claims.nbf);
    return builder.sign(claims.key ?? privateKey);
  }

  return {
    issuer,
    jwksUri,
    discoveryUrl: `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    audience: TEST_AUDIENCE,
    kid,
    jwksHits: () => jwksHits,
    discoveryHits: () => discoveryHits,
    setKeys: next => { keys = next; },
    stopJwks: () => { jwksDown = true; },
    failJwksWithStatus: status => { jwksStatus = status; },
    failJwksWithGarbage: () => { jwksGarbage = true; },
    resumeJwks: () => { jwksDown = false; jwksStatus = null; jwksGarbage = false; },
    publicJwk: () => ({ ...jwk }),
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    }),
    signAccessToken,
    signWithForeignKey: claims => signAccessToken({
      sub: claims.sub,
      groups: claims.groups,
      kid: claims.kid ?? kid,
      key: foreign.privateKey,
    }),
  };
}

/** Compact JWT with a forged header (e.g. alg:none / HS256) for negative cases. */
export function forgeCompactJwt(header: Record<string, unknown>, payload: Record<string, unknown>, signature = ''): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode(header)}.${encode(payload)}.${signature}`;
}

export async function signHs256WithModulus(jwk: JWK, payload: Record<string, unknown>): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const header = { alg: 'HS256', kid: jwk.kid, typ: 'JWT' };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const body = `${encode(header)}.${encode(payload)}`;
  // Use the RSA modulus bytes as an HMAC secret — proves we reject HS256 even
  // when the "secret" is derived from material present in the JWKS.
  const secret = Buffer.from(String(jwk.n), 'base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
