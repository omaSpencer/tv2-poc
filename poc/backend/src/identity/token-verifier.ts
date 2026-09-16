/**
 * Access-token verification (M2-04). jose + remote JWKS with fixed cache/cooldown.
 * Reasons are logged without the token; clients always see a generic 401 detail.
 */
import {
  createRemoteJWKSet, customFetch, errors as JoseErrors, jwtVerify,
  type JWTPayload,
} from 'jose';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Logger } from 'pino';
import { pino } from 'pino';
import { ApiError } from '../contracts/errors.js';
import type { Actor } from './actor.js';
import { OidcDiscovery } from './oidc.js';
import { rolesFromTokenClaims } from './roles.js';

/**
 * Raised when the JWKS endpoint itself is the problem: a non-200 HTTP answer, a
 * body that is not JSON, or a transport failure. Signature and claim failures
 * never produce this. Keeping the two apart is what makes an IdP outage a 503
 * instead of a 401 that tells the client to log in again (R08).
 */
export class JwksUnavailableError extends Error {
  constructor(readonly kind: 'http_status' | 'invalid_json' | 'network', detail: string) {
    super(`JWKS unavailable (${kind}): ${detail}`);
    this.name = 'JwksUnavailableError';
  }
}

/**
 * `jose` classifies a JWKS fetch failure only by message, and its own non-200
 * branch surfaces as a generic error that the caller cannot tell from a bad
 * signature. Intercepting the fetch gives a typed failure before `jose` sees it.
 * `jose` rethrows anything that is not a TimeoutError unchanged, so the type
 * survives to `mapJoseError`.
 */
const jwksFetch: NonNullable<Parameters<typeof createRemoteJWKSet>[1]>[typeof customFetch] = async (
  url,
  options,
) => {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    // A timeout must stay a TimeoutError so jose maps it to JWKSTimeout.
    if (error instanceof Error && error.name === 'TimeoutError') throw error;
    throw new JwksUnavailableError('network', error instanceof Error ? error.name : 'fetch failed');
  }
  if (response.status !== 200) {
    throw new JwksUnavailableError('http_status', String(response.status));
  }
  const text = await response.text().catch(() => null);
  if (text === null) {
    throw new JwksUnavailableError('network', 'body read failed');
  }
  try {
    JSON.parse(text);
  } catch {
    throw new JwksUnavailableError('invalid_json', 'body is not JSON');
  }
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const ACCEPTED_ALGS = ['RS256'] as const;
const GENERIC_401 = 'The access token is missing or invalid.';

export type VerifiedIdentity = {
  actor: Actor;
  expiresAt: Date;
};

export type TokenRejectReason =
  | 'missing_bearer'
  | 'malformed_bearer'
  | 'malformed_jwt'
  | 'alg'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'not_yet_valid'
  | 'missing_sub'
  | 'unknown_kid'
  | 'idp_unavailable';

/** Override hooks used by integration tests. */
export const TOKEN_VERIFIER_OPTIONS = 'TOKEN_VERIFIER_OPTIONS';
export type TokenVerifierOptions = {
  /** Fixed JWKS URI (skips discovery). */
  jwksUri?: string;
  /** Fixed issuer for verification when discovery is bypassed. */
  issuer?: string;
  jwksCacheMaxAgeMs?: number;
  jwksCooldownMs?: number;
};

@Injectable()
export class TokenVerifier {
  private readonly log: Logger;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksUri: string | null = null;
  private testOptions: TokenVerifierOptions | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(OidcDiscovery) private readonly discovery: OidcDiscovery,
    @Optional() @Inject(TOKEN_VERIFIER_OPTIONS) private readonly options: TokenVerifierOptions | null = null,
  ) {
    this.log = pino({ level: this.config.getOrThrow<string>('LOG_LEVEL') });
  }

  /** Test-only: override JWKS cache/cooldown without Nest testing utilities. */
  configureForTest(options: TokenVerifierOptions): void {
    this.testOptions = options;
    this.resetJwks();
  }

  private resolvedOptions(): TokenVerifierOptions | null {
    return this.testOptions ?? this.options;
  }

  /** Test helper: drop the cached JWKS handle so the next verify re-binds. */
  resetJwks(): void {
    this.jwks = null;
    this.jwksUri = null;
  }

  async verifyAccessToken(authorizationHeader: string | undefined): Promise<VerifiedIdentity> {
    const token = this.extractBearer(authorizationHeader);
    this.assertCompactJose(token);
    const { jwks, issuer } = await this.jwksSet();
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, jwks, {
        issuer,
        audience: this.discovery.audience,
        algorithms: [...ACCEPTED_ALGS],
        clockTolerance: this.discovery.clockToleranceSeconds,
      });
      payload = result.payload;
    } catch (error) {
      throw this.mapJoseError(error);
    }
    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.trim().length === 0) {
      this.reject('missing_sub');
    }
    const exp = payload.exp;
    if (typeof exp !== 'number') {
      this.reject('expired');
    }
    // Plan 2.3: a future `iat` is invalid within the same clock tolerance.
    // `jose` only checks this on its `maxTokenAge` path, which we do not use
    // (we impose no maximum token age), so the check lives here. A missing
    // `iat` stays accepted — the contract only constrains a present one.
    this.assertIssuedAtNotInFuture(payload.iat);
    const roles = rolesFromTokenClaims({ groups: payload.groups });
    return {
      actor: { sub: sub!, roles },
      expiresAt: new Date(exp! * 1000),
    };
  }

  /** Rejects an `iat` that is further ahead than the configured clock tolerance. */
  private assertIssuedAtNotInFuture(iat: unknown): void {
    if (iat === undefined) return;
    if (typeof iat !== 'number' || !Number.isFinite(iat)) this.reject('not_yet_valid');
    const nowSeconds = Math.floor(Date.now() / 1000);
    if ((iat as number) > nowSeconds + this.discovery.clockToleranceSeconds) {
      this.reject('not_yet_valid');
    }
  }

  private extractBearer(header: string | undefined): string {
    if (header === undefined || header.length === 0) this.reject('missing_bearer');
    const match = /^(Bearer) (.+)$/.exec(header!);
    if (!match || match[1] !== 'Bearer' || match[2]!.trim().length === 0 || /\s/.test(match[2]!)) {
      this.reject('malformed_bearer');
    }
    return match![2]!;
  }

  private assertCompactJose(token: string): void {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(part => part.length === 0)) {
      this.reject('malformed_jwt');
    }
    try {
      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as { alg?: unknown };
      if (header.alg !== 'RS256') this.reject('alg');
    } catch {
      this.reject('malformed_jwt');
    }
  }

  private async jwksSet(): Promise<{ jwks: ReturnType<typeof createRemoteJWKSet>; issuer: string }> {
    const options = this.resolvedOptions();
    if (options?.jwksUri) {
      if (!this.jwks || this.jwksUri !== options.jwksUri) {
        this.jwksUri = options.jwksUri;
        this.jwks = createRemoteJWKSet(new URL(options.jwksUri), {
          timeoutDuration: this.discovery.httpTimeoutMs,
          cooldownDuration: options.jwksCooldownMs ?? 30_000,
          cacheMaxAge: options.jwksCacheMaxAgeMs ?? 600_000,
          [customFetch]: jwksFetch,
        });
      }
      return { jwks: this.jwks, issuer: options.issuer ?? this.discovery.issuer };
    }
    let document;
    try {
      document = await this.discovery.document();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'dependency_unavailable') {
        this.log.warn({ event: 'token_rejected', reason: 'idp_unavailable' });
        throw error;
      }
      throw error;
    }
    if (!this.jwks || this.jwksUri !== document.jwks_uri) {
      this.jwksUri = document.jwks_uri;
      this.jwks = createRemoteJWKSet(new URL(document.jwks_uri), {
        timeoutDuration: this.discovery.httpTimeoutMs,
        cooldownDuration: options?.jwksCooldownMs ?? 30_000,
        cacheMaxAge: options?.jwksCacheMaxAgeMs ?? 600_000,
        [customFetch]: jwksFetch,
      });
    }
    return { jwks: this.jwks, issuer: document.issuer };
  }

  private mapJoseError(error: unknown): never {
    // Structural check first: a broken JWKS endpoint is our dependency failing,
    // not the client's token failing. Never decided by a message regex.
    if (error instanceof JwksUnavailableError) {
      this.log.warn({ event: 'token_rejected', reason: 'idp_unavailable', jwks: error.kind });
      throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
    }
    if (error instanceof JoseErrors.JWKSNoMatchingKey) this.reject('unknown_kid');
    if (error instanceof JoseErrors.JWKSTimeout || error instanceof JoseErrors.JWKSMultipleMatchingKeys) {
      this.log.warn({ event: 'token_rejected', reason: 'idp_unavailable' });
      throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
    }
    if (error instanceof TypeError || (error instanceof Error && /fetch|network|ECONNREFUSED|ENOTFOUND|timeout/i.test(error.message))) {
      this.log.warn({ event: 'token_rejected', reason: 'idp_unavailable' });
      throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
    }
    if (error instanceof JoseErrors.JWTExpired) this.reject('expired');
    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      const claim = (error as { claim?: string }).claim;
      if (claim === 'iss') this.reject('issuer');
      if (claim === 'aud') this.reject('audience');
      if (claim === 'nbf' || claim === 'iat') this.reject('not_yet_valid');
      if (claim === 'exp') this.reject('expired');
      this.reject('signature');
    }
    if (error instanceof JoseErrors.JWSSignatureVerificationFailed || error instanceof JoseErrors.JWSInvalid) {
      this.reject('signature');
    }
    if (error instanceof JoseErrors.JOSEAlgNotAllowed || error instanceof JoseErrors.JOSENotSupported) {
      this.reject('alg');
    }
    this.reject('signature');
  }

  private reject(reason: TokenRejectReason): never {
    this.log.warn({ event: 'token_rejected', reason });
    throw new ApiError('unauthenticated', GENERIC_401);
  }
}
