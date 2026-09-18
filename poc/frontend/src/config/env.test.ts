import { describe, expect, it } from 'vitest';
import { AUTH_SILENT_CALLBACK_PATH, loadFrontendConfig, resolveDocsHref } from './env';

describe('loadFrontendConfig', () => {
  it('returns an unconfigured state without partial OIDC values', () => {
    const config = loadFrontendConfig({});
    expect(config.oidc.kind).toBe('unconfigured');
    expect(config.allowManualToken).toBe(false);
    expect(config.apiBase).toBe('/api');
  });

  it('keeps the issuer and creates safe local redirect defaults including silent callback', () => {
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
        silentRedirectUri: `http://127.0.0.1:5173${AUTH_SILENT_CALLBACK_PATH}`,
      },
      allowManualToken: true,
      apiBase: '/api',
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

  it('requires explicit production redirect URLs including silent callback', () => {
    const base = {
      PROD: true,
      VITE_OIDC_CLIENT_ID: 'poc-backend',
      VITE_OIDC_ISSUER_URL: 'https://identity.example/application/o/poc-backend/',
    };
    expect(() => loadFrontendConfig(base)).toThrow('VITE_OIDC_REDIRECT_URI');
    expect(() => loadFrontendConfig({
      ...base,
      VITE_OIDC_REDIRECT_URI: 'https://app.example/auth/callback',
    })).toThrow('VITE_OIDC_POST_LOGOUT_REDIRECT_URI');
    expect(() => loadFrontendConfig({
      ...base,
      VITE_OIDC_REDIRECT_URI: 'https://app.example/auth/callback',
      VITE_OIDC_POST_LOGOUT_REDIRECT_URI: 'https://app.example/login',
    })).toThrow('VITE_OIDC_SILENT_REDIRECT_URI');
  });

  it('rejects enabling the manual token escape hatch in production', () => {
    expect(() => loadFrontendConfig({
      PROD: true,
      VITE_ALLOW_MANUAL_TOKEN: 'true',
    })).toThrow('VITE_ALLOW_MANUAL_TOKEN');
  });

  it('never uses the development proxy origin for browser docs links', () => {
    expect(resolveDocsHref('/docs', '/api')).toBe('/api/docs');
    expect(resolveDocsHref('/docs', '/api')).not.toContain('127.0.0.1:3000');
  });
});

describe('resolveDocsHref', () => {
  it('uses relative same-origin /api in production and development', () => {
    expect(resolveDocsHref()).toBe('/api/docs');
    expect(resolveDocsHref('/docs', '/api')).toBe('/api/docs');
    expect(resolveDocsHref('docs', '/api/')).toBe('/api/docs');
  });
});
