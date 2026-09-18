export type SecurityHeaderEnv = {
  VITE_OIDC_ISSUER_URL?: string;
};

export function oidcOriginFromIssuer(issuerUrl: string | undefined): string | null {
  const trimmed = issuerUrl?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.host) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(
  oidcOrigin: string | null,
  frameAncestors: "'none'" | "'self'" = "'none'",
): string {
  const extra = oidcOrigin ? ` ${oidcOrigin}` : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${extra}`,
    `frame-src 'self'${extra}`,
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${extra}`,
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

export function securityHeaders(
  oidcOrigin: string | null,
  silentCallback = false,
): Record<string, string> {
  return {
    'Content-Security-Policy': buildContentSecurityPolicy(
      oidcOrigin,
      silentCallback ? "'self'" : "'none'",
    ),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': silentCallback ? 'SAMEORIGIN' : 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

/** Nginx `add_header` block copied into the production image. */
export function renderNginxSecurityHeaders(
  env: SecurityHeaderEnv = {},
  silentCallback = false,
): string {
  const issuer = env.VITE_OIDC_ISSUER_URL?.trim();
  if (issuer && !oidcOriginFromIssuer(issuer)) {
    throw new Error('VITE_OIDC_ISSUER_URL nem érvényes HTTP(S) URL a CSP originhez.');
  }
  const headers = securityHeaders(oidcOriginFromIssuer(issuer), silentCallback);
  return `${Object.entries(headers)
    .map(([name, value]) => `add_header ${name} "${value.replaceAll('"', '\\"')}" always;`)
    .join('\n')}\n`;
}
