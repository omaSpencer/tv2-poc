export function AdminPlaceholder() {
  return (
    <section className="panel panel-muted">
      <h2>Szerkesztői API</h2>
      <p>
        Az egész <code className="mono">/admin</code> prefix jelenleg{' '}
        <code className="mono">503 dependency_unavailable</code>, amíg{' '}
        <code className="mono">FEATURE_IDENTITY=off</code>. Ez a backend szerződése, nem UI-hiba.
      </p>
      <p className="muted">
        M2 után: Authentik PKCE, <code className="mono">/me</code>, draft → publish → withdraw a mintafixture-rel.
        Addig az M1 életciklus bizonyítéka: <code className="mono">npm run demo:m1</code> a backendben.
      </p>
      <fieldset disabled className="stack">
        <legend>Hamarosan</legend>
        <button type="button">Create draft</button>
        <button type="button">Patch</button>
        <button type="button">Publish</button>
        <button type="button">Withdraw</button>
      </fieldset>
    </section>
  );
}
