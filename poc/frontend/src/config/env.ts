export type OidcRuntimeConfig = {
  kind: 'configured';
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
};

export type OidcUnavailableConfig = {
  kind: 'unconfigured';
  reason: string;
};

export type FrontendConfig = {
  oidc: OidcRuntimeConfig | OidcUnavailableConfig;
  allowManualToken: boolean;
};

type EnvSource = {
  PROD?: boolean;
  VITE_OIDC_ISSUER_URL?: string;
  VITE_OIDC_CLIENT_ID?: string;
  VITE_OIDC_REDIRECT_URI?: string;
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI?: string;
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

export function loadFrontendConfig(
  env: EnvSource,
  browserOrigin = 'http://127.0.0.1:5173',
): FrontendConfig {
  const issuerUrl = trimmed(env.VITE_OIDC_ISSUER_URL);
  const clientId = trimmed(env.VITE_OIDC_CLIENT_ID);
  const explicitRedirect = trimmed(env.VITE_OIDC_REDIRECT_URI);
  const explicitPostLogout = trimmed(env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI);
  const allowManualToken = env.VITE_ALLOW_MANUAL_TOKEN === 'true';

  if (!issuerUrl && !clientId) {
    return {
      oidc: { kind: 'unconfigured', reason: 'Az OIDC issuer és client ID nincs konfigurálva.' },
      allowManualToken,
    };
  }
  if (!issuerUrl || !clientId) {
    return {
      oidc: { kind: 'unconfigured', reason: 'Az OIDC issuer és client ID csak együtt adható meg.' },
      allowManualToken,
    };
  }
  if (!validHttpUrl(issuerUrl)) {
    return {
      oidc: { kind: 'unconfigured', reason: 'A VITE_OIDC_ISSUER_URL nem érvényes HTTP(S) URL.' },
      allowManualToken,
    };
  }

  if (env.PROD && !explicitRedirect) {
    throw new Error('Production buildhez VITE_OIDC_REDIRECT_URI szükséges.');
  }
  if (env.PROD && !explicitPostLogout) {
    throw new Error('Production buildhez VITE_OIDC_POST_LOGOUT_REDIRECT_URI szükséges.');
  }

  const redirectUri = explicitRedirect ?? `${browserOrigin}/auth/callback`;
  const postLogoutRedirectUri = explicitPostLogout ?? `${browserOrigin}/login`;
  if (!validHttpUrl(redirectUri) || !validHttpUrl(postLogoutRedirectUri)) {
    return {
      oidc: { kind: 'unconfigured', reason: 'Az OIDC redirect URL-ek nem érvényes HTTP(S) URL-ek.' },
      allowManualToken,
    };
  }

  return {
    oidc: { kind: 'configured', issuerUrl, clientId, redirectUri, postLogoutRedirectUri },
    allowManualToken,
  };
}

const browserOrigin = typeof window === 'undefined' ? 'http://127.0.0.1:5173' : window.location.origin;

export const frontendConfig = loadFrontendConfig(import.meta.env, browserOrigin);

