import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { fetchMe } from '../api/me';
import { isApiProblemError } from '../api/types';
import { useAuthSession } from '../auth/sessionContext';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { PermissionHints } from '../components/PermissionHints';
import { ProblemPanel } from '../components/ProblemPanel';

export function AuthPage() {
  const tokenInputId = useId();
  const { accessToken, setAccessToken, clearSession } = useAuthSession();
  const [draftToken, setDraftToken] = useState(accessToken ?? '');
  const oidcIssuer = import.meta.env.VITE_OIDC_ISSUER_URL;
  const oidcClientId = import.meta.env.VITE_OIDC_CLIENT_ID;

  const me = useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken!),
    enabled: Boolean(accessToken),
    retry: false,
  });

  function onSave(event: FormEvent) {
    event.preventDefault();
    setAccessToken(draftToken.trim() || null);
  }

  const meProblem =
    me.isError && isApiProblemError(me.error) && me.error.problem.code === 'dependency_unavailable';

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Auth (M2)</h2>
        <p className="muted">
          A backend resource server: Authorization Code + PKCE a kliens dolga. Amíg az Authentik
          provider nincs bekötve, ideiglenesen Bearer tokent tehetsz a sessionStorage-ba –{' '}
          <strong>nem</strong> actor header, nem fake admin bypass.
        </p>

        <MilestoneGate
          milestone="M2"
          feature="OIDC PKCE + GET /me"
          detail={
            oidcIssuer && oidcClientId
              ? `Konfigurált issuer: ${oidcIssuer}`
              : 'VITE_OIDC_ISSUER_URL / VITE_OIDC_CLIENT_ID még nincs kitöltve – PKCE gomb inaktív.'
          }
        />

        <fieldset className="stack" disabled>
          <legend>PKCE (később)</legend>
          <button type="button">Belépés Authentikkal</button>
          <p className="muted">A code flow az M2 provider adatok után kapcsolódik be.</p>
        </fieldset>

        <form className="stack" onSubmit={onSave}>
          <label htmlFor={tokenInputId}>
            Access token (Bearer)
            <textarea
              id={tokenInputId}
              className="mono token-input"
              rows={4}
              value={draftToken}
              onChange={(e) => setDraftToken(e.target.value)}
              placeholder="eyJ…"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="row">
            <button type="submit">Token mentése</button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                clearSession();
                setDraftToken('');
              }}
            >
              Kijelentkezés
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!accessToken}
              onClick={() => void me.refetch()}
            >
              GET /me
            </button>
          </div>
        </form>
      </section>

      {meProblem ? (
        <MilestoneGate
          milestone="M2"
          feature="Identity"
          detail="dependency_unavailable – FEATURE_IDENTITY valószínűleg off, vagy az adapter hiányzik."
        />
      ) : null}

      {me.isError ? <ProblemPanel error={me.error} title="/me hiba" /> : null}
      {me.isSuccess ? (
        <section className="panel">
          <h3>/me</h3>
          <p className="muted">
            HTTP {me.data.status} · correlationId{' '}
            <span className="mono">{me.data.correlationId || '—'}</span>
          </p>
          <JsonBlock value={me.data.data} />
          <PermissionHints me={me.data.data} />
        </section>
      ) : null}

      {!accessToken ? (
        <section className="panel panel-muted">
          <PermissionHints me={null} />
        </section>
      ) : null}
    </div>
  );
}
