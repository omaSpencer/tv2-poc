import { User } from 'oidc-client-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_SILENT_CALLBACK_PATH } from '../config/env';
import { MemoryStateStore } from './memoryStateStore';
import {
  clearSigninCallbackCache,
  completeSigninCallbackOnce,
  createOidcManager,
  handleSilentCallback,
  isLoginRequiredError,
  isOidcCallbackPath,
  isSilentCallbackPath,
  returnToFromUser,
  safeReturnTo,
} from './oidc';
import { browserWebStorageLeaksTokenMaterial } from './storageSentinel';

function user(state?: unknown): User {
  return new User({
    access_token: 'secret-access-token',
    token_type: 'Bearer',
    profile: { sub: 'user-1', iss: 'issuer', aud: 'client', exp: 4_000_000_000, iat: 1 },
    expires_at: 4_000_000_000,
    userState: state,
  });
}

describe('OIDC helpers', () => {
  it.each([
    ['/contents/one?tab=a#audit', '/contents/one?tab=a#audit'],
    ['https://evil.example', '/'],
    ['//evil.example/path', '/'],
    ['/safe\\evil', '/'],
    [undefined, '/'],
  ])('normalizes returnTo %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it('reads only a safe returnTo from OIDC state', () => {
    expect(returnToFromUser(user({ returnTo: '/operations' }))).toBe('/operations');
    expect(returnToFromUser(user({ returnTo: 'https://evil.example' }))).toBe('/');
  });

  it('consumes one callback URL once under StrictMode-style duplicate calls', async () => {
    clearSigninCallbackCache();
    const resolved = user({ returnTo: '/' });
    const manager = { signinRedirectCallback: vi.fn().mockResolvedValue(resolved) };
    const first = completeSigninCallbackOnce(manager, 'http://app/auth/callback?code=one');
    const second = completeSigninCallbackOnce(manager, 'http://app/auth/callback?code=one');
    await expect(first).resolves.toBe(resolved);
    await expect(second).resolves.toBe(resolved);
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it('starts a new callback after a successful one has settled', async () => {
    clearSigninCallbackCache();
    const firstUser = user({ returnTo: '/' });
    const secondUser = user({ returnTo: '/contents' });
    const manager = {
      signinRedirectCallback: vi.fn().mockResolvedValueOnce(firstUser).mockResolvedValueOnce(secondUser),
    };
    const url = 'http://app/auth/callback?code=one';
    await expect(completeSigninCallbackOnce(manager, url)).resolves.toBe(firstUser);
    await expect(completeSigninCallbackOnce(manager, url)).resolves.toBe(secondUser);
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(2);
  });

  it('starts a new callback after a failed one has settled', async () => {
    clearSigninCallbackCache();
    const manager = {
      signinRedirectCallback: vi.fn()
        .mockRejectedValueOnce(new Error('invalid_grant'))
        .mockResolvedValueOnce(user({ returnTo: '/' })),
    };
    const url = 'http://app/auth/callback?code=one';
    await expect(completeSigninCallbackOnce(manager, url)).rejects.toThrow('invalid_grant');
    await expect(completeSigninCallbackOnce(manager, url)).resolves.toMatchObject({ access_token: 'secret-access-token' });
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale finally drop a newer in-flight callback', async () => {
    clearSigninCallbackCache();
    let resolveFirst!: (value: User) => void;
    let resolveSecond!: (value: User) => void;
    const firstPromise = new Promise<User>(resolve => { resolveFirst = resolve; });
    const secondPromise = new Promise<User>(resolve => { resolveSecond = resolve; });
    const firstUser = user({ returnTo: '/one' });
    const secondUser = user({ returnTo: '/two' });
    const manager = {
      signinRedirectCallback: vi.fn().mockReturnValueOnce(firstPromise).mockReturnValueOnce(secondPromise),
    };
    const url = 'http://app/auth/callback?code=one';
    const first = completeSigninCallbackOnce(manager, url);
    clearSigninCallbackCache();
    const second = completeSigninCallbackOnce(manager, url);
    resolveFirst(firstUser);
    await expect(first).resolves.toBe(firstUser);
    const secondWaiter = completeSigninCallbackOnce(manager, url);
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(2);
    resolveSecond(secondUser);
    await expect(second).resolves.toBe(secondUser);
    await expect(secondWaiter).resolves.toBe(secondUser);
  });
});

const oidcConfig = {
  kind: 'configured' as const,
  issuerUrl: 'https://identity.example/application/o/poc-backend/',
  clientId: 'poc-backend',
  redirectUri: 'http://127.0.0.1:5173/auth/callback',
  postLogoutRedirectUri: 'http://127.0.0.1:5173/login',
  silentRedirectUri: `http://127.0.0.1:5173${AUTH_SILENT_CALLBACK_PATH}`,
};

describe('OIDC memory store and silent callback', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('stores the OIDC user in memory, not in browser storage', async () => {
    const userStore = new MemoryStateStore();
    const manager = createOidcManager(oidcConfig, userStore);
    expect(manager.settings.userStore).toBe(userStore);
    expect(manager.settings.silent_redirect_uri).toBe(oidcConfig.silentRedirectUri);
    await manager.storeUser(user({ returnTo: '/' }));
    expect(browserWebStorageLeaksTokenMaterial()).toEqual([]);
    expect(await manager.getUser()).toMatchObject({ access_token: 'secret-access-token' });
    expect(await userStore.getAllKeys()).not.toHaveLength(0);
  });

  it('classifies login_required as an anonymous IdP result', () => {
    expect(isLoginRequiredError({ error: 'login_required' })).toBe(true);
    expect(isLoginRequiredError(new Error('login_required'))).toBe(true);
    expect(isLoginRequiredError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isOidcCallbackPath('/auth/callback')).toBe(true);
    expect(isSilentCallbackPath(AUTH_SILENT_CALLBACK_PATH)).toBe(true);
    expect(isOidcCallbackPath('/login')).toBe(false);
  });

  it('runs signinSilentCallback without mounting the application tree', async () => {
    const signinSilentCallback = vi.fn().mockResolvedValue(undefined);
    const createManager = vi.fn(() => ({ signinSilentCallback }) as unknown as ReturnType<typeof createOidcManager>);
    await handleSilentCallback({
      oidc: { kind: 'unconfigured', reason: 'missing' },
      allowManualToken: false,
      apiBase: '/api',
    }, createManager);
    expect(createManager).not.toHaveBeenCalled();

    await handleSilentCallback({
      oidc: oidcConfig,
      allowManualToken: false,
      apiBase: '/api',
    }, createManager);
    expect(createManager).toHaveBeenCalledTimes(1);
    expect(signinSilentCallback).toHaveBeenCalledTimes(1);
  });
});

