import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from 'oidc-client-ts';
import { fetchMe } from '../api/me';
import { setApiAccessToken, setAuthRecoveryHandler } from '../api/client';
import { isApiProblemError, type MeResponse } from '../api/types';
import { frontendConfig } from '../config/env';
import { AuthContext } from './authContext';
import { meFromState, type AuthContextValue, type AuthState } from './authTypes';
import { readManualToken, writeManualToken } from './manualToken';
import {
  completeSigninCallbackOnce,
  createOidcManager,
  returnToFromUser,
  safeReturnTo,
} from './oidc';

function currentManualToken(): string | null {
  return readManualToken(frontendConfig.allowManualToken);
}

function persistManualToken(token: string | null): void {
  writeManualToken(frontendConfig.allowManualToken, token);
}

function safeAuthMessage(error: unknown): string {
  if (isApiProblemError(error)) {
    if (error.problem.status === 401) return 'A munkamenet lejárt vagy a token érvénytelen.';
    if (error.problem.code === 'dependency_unavailable') {
      return 'Az identitásszolgáltatás jelenleg nem elérhető.';
    }
    return `A bejelentkezés ellenőrzése sikertelen (${error.problem.code}).`;
  }
  return 'A bejelentkezés nem fejezhető be. Próbáld újra később.';
}

function currentPathname(): string {
  try {
    return window.location.pathname;
  } catch {
    return '/';
  }
}

function isLoginRequired(error: unknown): boolean {
  if (error && typeof error === 'object' && 'error' in error && typeof error.error === 'string') {
    if (
      error.error === 'login_required'
      || error.error === 'interaction_required'
      || error.error === 'consent_required'
      || error.error === 'account_selection_required'
    ) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /login_required|interaction_required/.test(message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const manager = useMemo(
    () => (frontendConfig.oidc.kind === 'configured' ? createOidcManager(frontendConfig.oidc) : null),
    [],
  );
  const [state, setState] = useState<AuthState>({ kind: 'bootstrapping' });
  const stateRef = useRef(state);
  const subjectRef = useRef<string | null>(null);
  const manualModeRef = useRef(false);
  const recoveryRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resetUserCache = useCallback(() => {
    queryClient.clear();
    subjectRef.current = null;
  }, [queryClient]);

  const anonymousState = useCallback((): AuthState => {
    if (frontendConfig.oidc.kind === 'unconfigured' && !frontendConfig.allowManualToken) {
      return { kind: 'unconfigured', message: frontendConfig.oidc.reason };
    }
    return { kind: 'anonymous' };
  }, []);

  const clearLocalSession = useCallback(() => {
    setApiAccessToken(null);
    persistManualToken(null);
    manualModeRef.current = false;
    resetUserCache();
    setState(anonymousState());
  }, [anonymousState, resetUserCache]);

  const dropStaleBearer = useCallback(async () => {
    setApiAccessToken(null);
    persistManualToken(null);
    manualModeRef.current = false;
    await manager?.removeUser().catch(() => undefined);
  }, [manager]);

  const acceptMe = useCallback((me: MeResponse) => {
    if (subjectRef.current && subjectRef.current !== me.sub) queryClient.clear();
    subjectRef.current = me.sub;
    setState({ kind: 'authenticated', me });
  }, [queryClient]);

  const validateCurrentToken = useCallback(async (previousMe: MeResponse | null = null): Promise<boolean> => {
    setState({ kind: 'loading_me' });
    try {
      const response = await fetchMe();
      acceptMe(response.data);
      return true;
    } catch (error) {
      if (isApiProblemError(error) && error.problem.status === 401) {
        clearLocalSession();
        return false;
      }
      setState({ kind: 'identity_unavailable', message: safeAuthMessage(error), me: previousMe });
      return false;
    }
  }, [acceptMe, clearLocalSession]);

  const acceptOidcUser = useCallback(async (user: User): Promise<boolean> => {
    if (!user.access_token || user.expired === true) return false;
    manualModeRef.current = false;
    persistManualToken(null);
    setApiAccessToken(user.access_token);
    return validateCurrentToken(meFromState(stateRef.current));
  }, [validateCurrentToken]);

  const recover = useCallback(async (): Promise<boolean> => {
    if (recoveryRef.current) return recoveryRef.current;
    const work = (async () => {
      if (!manager || manualModeRef.current) {
        await dropStaleBearer();
        clearLocalSession();
        return false;
      }
      setState({ kind: 'renewing', me: meFromState(stateRef.current) });
      try {
        const user = await manager.signinSilent();
        if (!user) {
          await dropStaleBearer();
          clearLocalSession();
          return false;
        }
        return acceptOidcUser(user);
      } catch (error) {
        await dropStaleBearer();
        if (isLoginRequired(error)) {
          clearLocalSession();
          return false;
        }
        resetUserCache();
        setState({
          kind: 'identity_unavailable',
          message: safeAuthMessage(error),
          me: meFromState(stateRef.current),
        });
        return false;
      }
    })().finally(() => {
      recoveryRef.current = null;
    });
    recoveryRef.current = work;
    return work;
  }, [acceptOidcUser, clearLocalSession, dropStaleBearer, manager, resetUserCache]);

  const bootstrap = useCallback(async (): Promise<void> => {
    if (manager) {
      try {
        const user = await manager.getUser();
        if (user && user.expired !== true && await acceptOidcUser(user)) return;
        const pathname = currentPathname();
        if (pathname === '/auth/callback' || pathname === '/auth/silent-callback') return;
        const silentUser = await manager.signinSilent();
        if (silentUser && await acceptOidcUser(silentUser)) return;
      } catch (error) {
        await dropStaleBearer();
        if (!isLoginRequired(error)) {
          setState({ kind: 'identity_unavailable', message: safeAuthMessage(error), me: null });
          return;
        }
      }
    }

    const manualToken = currentManualToken();
    if (manualToken) {
      manualModeRef.current = true;
      setApiAccessToken(manualToken);
      await validateCurrentToken();
      return;
    }
    setApiAccessToken(null);
    setState(anonymousState());
  }, [acceptOidcUser, anonymousState, dropStaleBearer, manager, validateCurrentToken]);

  const retry = useCallback(async (): Promise<void> => {
    setState({ kind: 'bootstrapping' });
    await bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    setAuthRecoveryHandler(recover);
    const bootstrapTimer = window.setTimeout(() => void bootstrap(), 0);
    return () => {
      window.clearTimeout(bootstrapTimer);
      setAuthRecoveryHandler(null);
    };
  }, [bootstrap, recover]);

  useEffect(() => {
    if (!manager) return undefined;
    const removeLoaded = manager.events.addUserLoaded((user) => {
      void acceptOidcUser(user);
    });
    const removeUnloaded = manager.events.addUserUnloaded(() => {
      clearLocalSession();
    });
    const removeExpiring = manager.events.addAccessTokenExpiring(() => {
      setState({ kind: 'renewing', me: meFromState(stateRef.current) });
    });
    const removeExpired = manager.events.addAccessTokenExpired(() => {
      void dropStaleBearer();
      setState({ kind: 'expired' });
    });
    const removeRenewError = manager.events.addSilentRenewError((error) => {
      void (async () => {
        await dropStaleBearer();
        if (isLoginRequired(error)) {
          clearLocalSession();
          return;
        }
        resetUserCache();
        setState({
          kind: 'identity_unavailable',
          message: 'A munkamenet megújítása sikertelen.',
          me: meFromState(stateRef.current),
        });
      })();
    });
    return () => {
      removeLoaded();
      removeUnloaded();
      removeExpiring();
      removeExpired();
      removeRenewError();
      manager.stopSilentRenew();
    };
  }, [acceptOidcUser, clearLocalSession, dropStaleBearer, manager, resetUserCache]);

  const login = useCallback(async (returnTo?: string) => {
    if (!manager) {
      setState({
        kind: 'unconfigured',
        message: frontendConfig.oidc.kind === 'unconfigured'
          ? frontendConfig.oidc.reason
          : 'Az OIDC kliens nincs konfigurálva.',
      });
      return;
    }
    setState({ kind: 'authenticating' });
    await manager.signinRedirect({ state: { returnTo: safeReturnTo(returnTo) } });
  }, [manager]);

  const completeCallback = useCallback(async (): Promise<string> => {
    if (!manager) throw new Error('Az OIDC kliens nincs konfigurálva.');
    setState({ kind: 'authenticating' });
    try {
      const user = await completeSigninCallbackOnce(manager);
      const returnTo = returnToFromUser(user);
      const accepted = await acceptOidcUser(user);
      if (!accepted) throw new Error('A kapott access token lejárt vagy hiányzik.');
      return returnTo;
    } catch (error) {
      await dropStaleBearer();
      setState({ kind: 'identity_unavailable', message: safeAuthMessage(error), me: null });
      throw error;
    }
  }, [acceptOidcUser, dropStaleBearer, manager]);

  const logout = useCallback(async () => {
    const user = await manager?.getUser().catch(() => null);
    await manager?.removeUser().catch(() => undefined);
    clearLocalSession();
    if (manager && frontendConfig.oidc.kind === 'configured') {
      try {
        await manager.signoutRedirect({
          id_token_hint: user?.id_token,
          post_logout_redirect_uri: frontendConfig.oidc.postLogoutRedirectUri,
        });
        return;
      } catch {
        // Local logout is already complete; IdP logout is best effort.
      }
    }
    window.location.assign('/login');
  }, [clearLocalSession, manager]);

  const setManualToken = useCallback(async (raw: string | null) => {
    if (!frontendConfig.allowManualToken) return;
    const token = raw?.trim() || null;
    await manager?.removeUser().catch(() => undefined);
    resetUserCache();
    if (!token) {
      clearLocalSession();
      return;
    }
    manualModeRef.current = true;
    persistManualToken(token);
    setApiAccessToken(token);
    await validateCurrentToken();
  }, [clearLocalSession, manager, resetUserCache, validateCurrentToken]);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    me: meFromState(state),
    isAuthenticated: state.kind === 'authenticated',
    manualTokenAllowed: frontendConfig.allowManualToken,
    login,
    completeCallback,
    logout,
    retry,
    setManualToken,
  }), [completeCallback, login, logout, retry, setManualToken, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
