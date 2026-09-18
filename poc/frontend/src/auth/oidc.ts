import { ErrorResponse, UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import {
  AUTH_CALLBACK_PATH,
  AUTH_SILENT_CALLBACK_PATH,
  type FrontendConfig,
  type OidcRuntimeConfig,
} from '../config/env';
import { MemoryStateStore } from './memoryStateStore';

const callbackRequests = new Map<string, Promise<User>>();
type CallbackManager = Pick<UserManager, 'signinRedirectCallback'>;

const INTERACTION_ERRORS = new Set([
  'login_required',
  'interaction_required',
  'consent_required',
  'account_selection_required',
]);

export function isOidcCallbackPath(pathname: string): boolean {
  return pathname === AUTH_CALLBACK_PATH || pathname === AUTH_SILENT_CALLBACK_PATH;
}

export function isSilentCallbackPath(pathname: string): boolean {
  return pathname === AUTH_SILENT_CALLBACK_PATH;
}

export function isLoginRequiredError(error: unknown): boolean {
  if (error instanceof ErrorResponse && error.error && INTERACTION_ERRORS.has(error.error)) {
    return true;
  }
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
    if (INTERACTION_ERRORS.has(error.error)) return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return INTERACTION_ERRORS.has(message) || /login_required|interaction_required/.test(message);
}

export function createOidcManager(
  config: OidcRuntimeConfig,
  userStore: MemoryStateStore = new MemoryStateStore(),
): UserManager {
  return new UserManager({
    authority: config.issuerUrl,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    silent_redirect_uri: config.silentRedirectUri,
    response_type: 'code',
    scope: 'openid profile offline_access poc-aud',
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
    silentRequestTimeoutInSeconds: 10,
    maxSilentRenewTimeoutRetries: 1,
    includeIdTokenInSilentRenew: true,
    monitorSession: false,
    loadUserInfo: false,
    revokeTokensOnSignout: false,
    userStore,
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

export async function handleSilentCallback(
  config: FrontendConfig,
  createManager: typeof createOidcManager = createOidcManager,
): Promise<void> {
  if (config.oidc.kind !== 'configured') return;
  const manager = createManager(config.oidc);
  await manager.signinSilentCallback();
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
