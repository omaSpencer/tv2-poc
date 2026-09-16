import { createContext, useContext } from 'react';

export type AuthSessionValue = {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  clearSession: () => void;
};

export const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export function useAuthSession(): AuthSessionValue {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error('useAuthSession requires AuthSessionProvider');
  return context;
}
