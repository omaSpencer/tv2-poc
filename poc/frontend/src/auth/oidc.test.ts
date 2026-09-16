import { describe, expect, it, vi } from 'vitest';
import { User } from 'oidc-client-ts';
import { clearSigninCallbackCache, completeSigninCallbackOnce, returnToFromUser, safeReturnTo } from './oidc';

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
});

