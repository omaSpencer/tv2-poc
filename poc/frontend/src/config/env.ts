export const AUTH_CALLBACK_PATH = '/auth/callback';
export const AUTH_SILENT_CALLBACK_PATH = '/auth/silent-callback';

export type OidcRuntimeConfig = {
  kind: 'configured';
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  silentRedirectUri: string;
};

export type OidcUnavailableConfig = {
  kind: 'unconfigured';
  reason: string;
};

export type FrontendConfig = {
  oidc: OidcRuntimeConfig | OidcUnavailableConfig;
  allowManualToken: boolean;
  apiBase: string;
};

type EnvSource = {
  PROD?: boolean;
  VITE_API_BASE?: string;
  VITE_BACKEND_ORIGIN?: string;
  VITE_OIDC_ISSUER_URL?: string;
  VITE_OIDC_CLIENT_ID?: string;
  VITE_OIDC_REDIRECT_URI?: string;
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI?: string;
  VITE_OIDC_SILENT_REDIRECT_URI?: string;
  VITE_ALLOW_MANUAL_TOKEN?: string;
};

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host.length > 0;
  } catch {
    return false;
  }
}

function resolveApiBase(env: EnvSource): string {
  return trimmed(env.VITE_API_BASE)?.replace(/\/$/, '') || '/api';
}

/**
 * Same-origin docs href. Production ingress serves `/api`; the Vite proxy does
 * too in development. `VITE_BACKEND_ORIGIN` is never a browser docs origin.
 */
export function resolveDocsHref(path = '/docs', apiBase = '/api'): string {
  const base = apiBase.replace(/\/$/, '') || '/api';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function loadFrontendConfig(
  env: EnvSource,
  browserOrigin = 'http://127.0.0.1:5173',
): FrontendConfig {
  const apiBase = resolveApiBase(env);
  const backendOrigin = trimmed(env.VITE_BACKEND_ORIGIN);
  if (backendOrigin && !validHttpUrl(backendOrigin)) {
    throw new Error('VITE_BACKEND_ORIGIN nem érvényes HTTP(S) URL.');
  }

  const allowManualToken = env.VITE_ALLOW_MANUAL_TOKEN === 'true';
  if (env.PROD && allowManualToken) {
    throw new Error('VITE_ALLOW_MANUAL_TOKEN productionben nem engedélyezett.');
  }

  const issuerUrl = trimmed(env.VITE_OIDC_ISSUER_URL);
  const clientId = trimmed(env.VITE_OIDC_CLIENT_ID);
  const explicitRedirect = trimmed(env.VITE_OIDC_REDIRECT_URI);
  const explicitPostLogout = trimmed(env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI);
  const explicitSilent = trimmed(env.VITE_OIDC_SILENT_REDIRECT_URI);

  if (!issuerUrl && !clientId) {
    return {
      oidc: { kind: 'unconfigured', reason: 'Az OIDC issuer és client ID nincs konfigurálva.' },
      allowManualToken,
      apiBase,
    };
  }
  if (!issuerUrl || !clientId) {
    return {
      oidc: { kind: 'unconfigured', reason: 'Az OIDC issuer és client ID csak együtt adható meg.' },
      allowManualToken,
      apiBase,
    };
  }
  if (!validHttpUrl(issuerUrl)) {
    return {
      oidc: { kind: 'unconfigured', reason: 'A VITE_OIDC_ISSUER_URL nem érvényes HTTP(S) URL.' },
      allowManualToken,
      apiBase,
    };
  }

  if (env.PROD && !explicitRedirect) {
    throw new Error('Production buildhez VITE_OIDC_REDIRECT_URI szükséges.');
  }
  if (env.PROD && !explicitPostLogout) {
    throw new Error('Production buildhez VITE_OIDC_POST_LOGOUT_REDIRECT_URI szükséges.');
  }
  if (env.PROD && !explicitSilent) {
    throw new Error('Production buildhez VITE_OIDC_SILENT_REDIRECT_URI szükséges.');
  }

  const redirectUri = explicitRedirect ?? `${browserOrigin}${AUTH_CALLBACK_PATH}`;
  const postLogoutRedirectUri = explicitPostLogout ?? `${browserOrigin}/login`;
  const silentRedirectUri = explicitSilent ?? `${browserOrigin}${AUTH_SILENT_CALLBACK_PATH}`;
  if (!validHttpUrl(redirectUri) || !validHttpUrl(postLogoutRedirectUri) || !validHttpUrl(silentRedirectUri)) {
    return {
      oidc: { kind: 'unconfigured', reason: 'Az OIDC redirect URL-ek nem érvényes HTTP(S) URL-ek.' },
      allowManualToken,
      apiBase,
    };
  }

  return {
    oidc: {
      kind: 'configured',
      issuerUrl,
      clientId,
      redirectUri,
      postLogoutRedirectUri,
      silentRedirectUri,
    },
    allowManualToken,
    apiBase,
  };
}

const browserOrigin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;

export const frontendConfig = loadFrontendConfig(import.meta.env, browserOrigin);
