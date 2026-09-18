import { describe, expect, it } from 'vitest';
import nginxConf from '../../nginx.conf?raw';
import committedHeaders from '../../security-headers.conf?raw';
import {
  buildContentSecurityPolicy,
  oidcOriginFromIssuer,
  renderNginxSecurityHeaders,
} from './securityHeaders';

describe('security headers / CSP', () => {
  it('never allows unsafe-eval or unbounded script sources', () => {
    const csp = buildContentSecurityPolicy('https://identity.example');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*\*/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
  });

  it('limits connect-src and frame-src to same-origin and the configured OIDC origin', () => {
    expect(oidcOriginFromIssuer('http://127.0.0.1:9000/application/o/poc-backend/')).toBe('http://127.0.0.1:9000');
    const csp = buildContentSecurityPolicy('http://127.0.0.1:9000');
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:9000");
    expect(csp).toContain("frame-src 'self' http://127.0.0.1:9000");
  });

  it('keeps same-origin-only CSP when no issuer is configured', () => {
    const rendered = renderNginxSecurityHeaders({});
    expect(rendered).toContain("connect-src 'self'");
    expect(rendered).not.toContain('unsafe-eval');
    expect(rendered).toContain("frame-ancestors 'none'");
  });

  it('fails fast on an explicit invalid issuer used for CSP', () => {
    expect(() => renderNginxSecurityHeaders({ VITE_OIDC_ISSUER_URL: 'not a URL' })).toThrow('VITE_OIDC_ISSUER_URL');
  });

  it('keeps the committed nginx posture free of unsafe-eval', () => {
    expect(nginxConf).toContain('include /etc/nginx/security-headers.conf;');
    expect(committedHeaders).not.toContain('unsafe-eval');
    expect(committedHeaders).toContain("frame-ancestors 'none'");
  });
});
