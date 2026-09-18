import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import type { OidcRuntimeConfig } from '../config/env';

const callbackRequests = new Map<string, Promise<User>>();
type CallbackManager = Pick<UserManager, 'signinRedirectCallback'>;

export function createOidcManager(config: OidcRuntimeConfig): UserManager {
  return new UserManager({
    authority: config.issuerUrl,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    response_type: 'code',
    scope: 'openid profile offline_access poc-aud',
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
    maxSilentRenewTimeoutRetries: 1,
    monitorSession: false,
    loadUserInfo: false,
    revokeTokensOnSignout: false,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

export function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  try {
    const parsed = new URL(value, 'http://internal.invalid');
    if (parsed.origin !== 'http://internal.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function returnToFromUser(user: User): string {
  const state = user.state;
  if (!state || typeof state !== 'object') return '/';
  return safeReturnTo((state as { returnTo?: unknown }).returnTo);
}

/** StrictMode may mount the callback screen twice; consume one authorization code once. */
export function completeSigninCallbackOnce(manager: CallbackManager, url = window.location.href): Promise<User> {
  const existing = callbackRequests.get(url);
  if (existing) return existing;
  const request = manager.signinRedirectCallback(url);
  callbackRequests.set(url, request);
  void request.then(
    () => {
      if (callbackRequests.get(url) === request) callbackRequests.delete(url);
    },
    () => {
      if (callbackRequests.get(url) === request) callbackRequests.delete(url);
    },
  );
  return request;
}

export function clearSigninCallbackCache(): void {
  callbackRequests.clear();
}
