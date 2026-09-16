export function PhasePlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p className="muted">
        Az útvonal és a jogosultsági védelem elkészült. A teljes képernyő a {phase}. fázisban készül.
      </p>
    </section>
  );
}

