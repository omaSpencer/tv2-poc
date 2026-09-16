import { describe, expect, it } from 'vitest';
import { loadFrontendConfig } from './env';

describe('loadFrontendConfig', () => {
  it('returns an unconfigured state without partial OIDC values', () => {
    const config = loadFrontendConfig({});
    expect(config.oidc.kind).toBe('unconfigured');
    expect(config.allowManualToken).toBe(false);
  });

  it('keeps the issuer and creates safe local redirect defaults', () => {
    const config = loadFrontendConfig({
      VITE_OIDC_ISSUER_URL: 'http://127.0.0.1:9000/application/o/poc-backend/',
      VITE_OIDC_CLIENT_ID: 'poc-backend',
      VITE_ALLOW_MANUAL_TOKEN: 'true',
    });
    expect(config).toEqual({
      oidc: {
        kind: 'configured',
        issuerUrl: 'http://127.0.0.1:9000/application/o/poc-backend/',
        clientId: 'poc-backend',
        redirectUri: 'http://127.0.0.1:5173/auth/callback',
        postLogoutRedirectUri: 'http://127.0.0.1:5173/login',
      },
      allowManualToken: true,
    });
  });

  it('rejects partial and malformed configuration without echoing values', () => {
    const partial = loadFrontendConfig({ VITE_OIDC_CLIENT_ID: 'poc-backend' });
    const malformed = loadFrontendConfig({
      VITE_OIDC_CLIENT_ID: 'poc-backend',
      VITE_OIDC_ISSUER_URL: 'not a URL',
    });
    expect(partial.oidc.kind).toBe('unconfigured');
    expect(malformed.oidc.kind).toBe('unconfigured');
    expect(JSON.stringify(malformed)).not.toContain('not a URL');
  });

  it('requires explicit production redirect URLs', () => {
    expect(() => loadFrontendConfig({
      PROD: true,
      VITE_OIDC_CLIENT_ID: 'poc-backend',
      VITE_OIDC_ISSUER_URL: 'https://identity.example/application/o/poc-backend/',
    })).toThrow('VITE_OIDC_REDIRECT_URI');
  });
});

