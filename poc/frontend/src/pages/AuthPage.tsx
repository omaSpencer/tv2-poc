import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/authContext';
import { safeReturnTo } from '../auth/oidc';
import { PermissionHints } from '../components/PermissionHints';

function stateLabel(kind: string): string {
  const labels: Record<string, string> = {
    bootstrapping: 'Munkamenet ellenőrzése',
    unconfigured: 'OIDC nincs konfigurálva',
    anonymous: 'Nincs bejelentkezve',
    authenticating: 'Átirányítás az identity providerhez',
    loading_me: 'Jogosultságok betöltése',
    authenticated: 'Bejelentkezve',
    renewing: 'Munkamenet megújítása',
    expired: 'Lejárt munkamenet',
    identity_unavailable: 'Identity szolgáltatás nem elérhető',
  };
  return labels[kind] ?? kind;
}
export function AuthPage() {
  const tokenInputId = useId();
  const [searchParams] = useSearchParams();
  const { state, me, manualTokenAllowed, login, logout, retry, setManualToken } = useAuth();
  const [draftToken, setDraftToken] = useState('');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));

  async function onManualToken(event: FormEvent) {
    event.preventDefault();
    await setManualToken(draftToken || null);
    setDraftToken('');
  }

  const busy = ['bootstrapping', 'authenticating', 'loading_me', 'renewing'].includes(state.kind);

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Bejelentkezés</h2>
        <p className="muted">
          Authentik Authorization Code + PKCE. Az alkalmazásjogok kizárólag a backend{' '}
          <code className="mono">GET /me</code> válaszából származnak.
        </p>
        <dl className="kv">
          <div><dt>Állapot</dt><dd>{stateLabel(state.kind)}</dd></div>
          {me ? <div><dt>Lejárat</dt><dd className="mono">{me.expiresAt}</dd></div> : null}
        </dl>

        {state.kind === 'unconfigured' || state.kind === 'identity_unavailable' ? (
          <p className="field-error" role="alert">{state.message}</p>
        ) : null}
        {state.kind === 'expired' ? (
          <p className="field-error" role="alert">A munkamenet lejárt. Jelentkezz be újra.</p>
        ) : null}

        <div className="row wrap-gap">
          {state.kind === 'authenticated' ? (
            <button type="button" className="btn-secondary" onClick={() => void logout()}>
              Kijelentkezés
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || state.kind === 'unconfigured'}
              onClick={() => void login(returnTo)}
            >
              Belépés Authentikkal
            </button>
          )}
          {(state.kind === 'identity_unavailable' || state.kind === 'expired') ? (
            <button type="button" className="btn-secondary" onClick={() => void retry()}>
              Újrapróbálás
            </button>
          ) : null}
        </div>
      </section>

      {manualTokenAllowed ? (
        <details className="panel">
          <summary>Fejlesztői token – csak helyi hibakereséshez</summary>
          <form className="stack top-gap" onSubmit={onManualToken}>
            <label htmlFor={tokenInputId}>
              Access token (Bearer)
              <textarea
                id={tokenInputId}
                className="mono token-input"
                rows={4}
                value={draftToken}
                onChange={(event) => setDraftToken(event.target.value)}
                placeholder="eyJ…"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <div className="row">
              <button type="submit">Token ellenőrzése</button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDraftToken('');
                  void setManualToken(null);
                }}
              >
                Fejlesztői session törlése
              </button>
            </div>
          </form>
        </details>
      ) : null}

      <section className="panel panel-muted"><PermissionHints me={me} /></section>
    </div>
  );
}
