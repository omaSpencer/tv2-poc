import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './authContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, retry } = useAuth();
  const location = useLocation();

  if (state.kind === 'bootstrapping' || state.kind === 'loading_me' || state.kind === 'renewing') {
    return <section className="panel" role="status">Munkamenet ellenőrzése…</section>;
  }
  if (state.kind === 'identity_unavailable') {
    return (
      <section className="panel panel-error" role="alert">
        <h2>Az identity szolgáltatás nem elérhető</h2>
        <p>{state.message}</p>
        <button type="button" onClick={() => void retry()}>Újrapróbálás</button>
      </section>
    );
  }
  if (state.kind !== 'authenticated') {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return children;
}
