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

@Injectable()
export class OidcDiscovery {
  private cached: DiscoveryDocument | null = null;
  private inflight: Promise<DiscoveryDocument> | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  get issuer(): string {
    return this.config.getOrThrow<string>('OIDC_ISSUER_URL');
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
    const issuer = this.issuer.replace(/\/$/, '');
    const url = `${issuer}/.well-known/openid-configuration`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(this.httpTimeoutMs) });
    } catch {
      throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
    }
    if (!response.ok) {
      throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError('dependency_unavailable', 'The identity provider is currently unavailable.');
    }
    const parsed = discoverySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('dependency_unavailable', 'The identity provider discovery document is invalid.');
    }
    if (parsed.data.issuer !== this.issuer) {
      throw new ApiError('dependency_unavailable', 'The identity provider issuer does not match configuration.');
    }
    const configuredJwks = this.configuredJwksUri;
    if (configuredJwks && configuredJwks !== parsed.data.jwks_uri) {
      throw new ApiError('dependency_unavailable', 'The configured JWKS URI does not match discovery.');
    }
    this.cached = parsed.data;
    return parsed.data;
  }
}
