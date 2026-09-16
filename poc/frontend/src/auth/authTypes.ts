import type { MeResponse } from '../api/types';

export type AuthState =
  | { kind: 'bootstrapping' }
  | { kind: 'unconfigured'; message: string }
  | { kind: 'anonymous' }
  | { kind: 'authenticating' }
  | { kind: 'loading_me' }
  | { kind: 'authenticated'; me: MeResponse }
  | { kind: 'renewing'; me: MeResponse | null }
  | { kind: 'expired' }
  | { kind: 'identity_unavailable'; message: string; me: MeResponse | null };

export type AuthContextValue = {
  state: AuthState;
  me: MeResponse | null;
  isAuthenticated: boolean;
  manualTokenAllowed: boolean;
  login: (returnTo?: string) => Promise<void>;
  completeCallback: () => Promise<string>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  setManualToken: (token: string | null) => Promise<void>;
};

export function meFromState(state: AuthState): MeResponse | null {
  if (state.kind === 'authenticated' || state.kind === 'renewing') return state.me;
  if (state.kind === 'identity_unavailable') return state.me;
  return null;
}

