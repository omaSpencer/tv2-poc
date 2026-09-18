import { Link } from 'react-router';

export function HomePage() {
  return (
    <section className="panel">
      <h2>Demófelület</h2>
      <p>
        Böngészős kliens a NestJS PoC API kipróbálásához. A screenek a{' '}
        <code className="mono">MILESTONES.md</code> demóútvonalát követik. A backend M0–M5
        képességeihez kapcsolódó HTTP-válaszokat és a kikapcsolt függőségek problem+json / 503
        állapotát a UI külön kezeli.
      </p>
      <ol className="route-list">
        <li>
          <Link to="/login">Belépés</Link> – Authentik PKCE és <code className="mono">GET /me</code>
        </li>
        <li>
          <Link to="/contents">Tartalmak</Link> – draft → patch → publish → withdraw
        </li>
        <li>
          <Link to="/catalog/search">Katalógus</Link> – publikus keresés és részlet
        </li>
        <li>
          <Link to="/operations">Operáció</Link> – M3–M5 outbox / lag / indexállapot
        </li>
        <li>
          <Link to="/demo">Demó</Link> – mintafolyamat lépésenként
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
