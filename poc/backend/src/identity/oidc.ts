/**
 * OIDC discovery document client (M2-04). Lazy: first token verification loads
 * it. Successful documents are cached for the process lifetime; failures are not.
 */
import { z } from 'zod';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '../contracts/errors.js';

const discoverySchema = z.object({
  issuer: z.string().min(1),
  jwks_uri: z.url(),
});

export type DiscoveryDocument = z.infer<typeof discoverySchema>;

export type OidcDiscoveryFailure =
  | 'network'
  | 'http_status'
  | 'invalid_json'
  | 'invalid_document'
  | 'issuer_mismatch'
  | 'jwks_mismatch';

export class OidcDiscoveryError extends ApiError {
  constructor(readonly category: OidcDiscoveryFailure, detail: string) {
    super('dependency_unavailable', detail);
    this.name = 'OidcDiscoveryError';
  }
}

/** Issuers are compared and verified with exactly one trailing slash. */
export function canonicalIssuer(value: string): string {
  return `${value.replace(/\/+$/, '')}/`;
}

@Injectable()
export class OidcDiscovery {
  private cached: DiscoveryDocument | null = null;
  private inflight: Promise<DiscoveryDocument> | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  get issuer(): string {
    return canonicalIssuer(this.config.getOrThrow<string>('OIDC_ISSUER_URL'));
  }

  get audience(): string {
    return this.config.getOrThrow<string>('OIDC_AUDIENCE');
  }

  get configuredJwksUri(): string | undefined {
    return this.config.get<string>('OIDC_JWKS_URI');
  }

  get clockToleranceSeconds(): number {
    return this.config.getOrThrow<number>('OIDC_CLOCK_TOLERANCE_S');
  }

  get httpTimeoutMs(): number {
    return this.config.getOrThrow<number>('OIDC_HTTP_TIMEOUT_MS');
  }

  /** Test helper: clear the process-lifetime cache. */
  reset(): void {
    this.cached = null;
    this.inflight = null;
  }

  async document(): Promise<DiscoveryDocument> {
    if (this.cached) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchOnce().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchOnce(): Promise<DiscoveryDocument> {
    const issuer = this.issuer;
    const url = `${issuer.slice(0, -1)}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(this.httpTimeoutMs) });
    } catch {
      throw new OidcDiscoveryError('network', 'The identity provider is currently unavailable.');
    }
    if (!response.ok) {
      throw new OidcDiscoveryError('http_status', 'The identity provider is currently unavailable.');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OidcDiscoveryError('invalid_json', 'The identity provider is currently unavailable.');
    }
    const parsed = discoverySchema.safeParse(body);
    if (!parsed.success) {
      throw new OidcDiscoveryError('invalid_document', 'The identity provider discovery document is invalid.');
    }
    if (canonicalIssuer(parsed.data.issuer) !== issuer) {
      throw new OidcDiscoveryError('issuer_mismatch', 'The identity provider issuer does not match configuration.');
    }
    const configuredJwks = this.configuredJwksUri;
    if (configuredJwks && configuredJwks !== parsed.data.jwks_uri) {
      throw new OidcDiscoveryError('jwks_mismatch', 'The configured JWKS URI does not match discovery.');
    }
    this.cached = { ...parsed.data, issuer };
    return this.cached;
  }
}
