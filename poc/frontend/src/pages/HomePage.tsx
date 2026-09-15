import { Link } from 'react-router';

export function HomePage() {
  return (
    <section className="panel">
      <h2>Demo playground</h2>
      <p>
        Böngészős kliens a NestJS PoC API kipróbálásához. A screenek a{' '}
        <code className="mono">MILESTONES.md</code> demóútvonalát követik; a backend M2–M4 előtt a
        hiányzó végpontok problem+json / 503 választ adnak – a UI ezt kezeli.
      </p>
      <ol className="route-list">
        <li>
          <Link to="/auth">Auth</Link> – Bearer / későbbi PKCE, <code className="mono">GET /me</code>
        </li>
        <li>
          <Link to="/editorial">Editorial</Link> – draft → patch → publish → withdraw
        </li>
        <li>
          <Link to="/catalog">Catalog</Link> – publikus részlet (login nélkül)
        </li>
        <li>
          <Link to="/search">Search</Link> – M4 katalóguskeresés
        </li>
        <li>
          <Link to="/processing">Processing</Link> – M3 outbox / lag
        </li>
        <li>
          <Link to="/demo">Demo</Link> – mintafolyamat lépésenként
        </li>
      </ol>
      <p className="muted">
        Nincs identity-bypass: actor header / body nem megy. Amíg{' '}
        <code className="mono">FEATURE_IDENTITY=off</code>, az <code className="mono">/admin</code>{' '}
        503.
      </p>
    </section>
  );
}
