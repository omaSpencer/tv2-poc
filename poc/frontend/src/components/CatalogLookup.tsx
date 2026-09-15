import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { fetchPublishedContent } from '../api/catalog';
import { ProblemPanel } from './ProblemPanel';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CatalogLookup() {
  const inputId = useId();
  const [draftId, setDraftId] = useState('');
  const [contentId, setContentId] = useState<string | null>(null);
  const [shapeError, setShapeError] = useState<Error | null>(null);

  const query = useQuery({
    queryKey: ['catalog-content', contentId],
    queryFn: () => fetchPublishedContent(contentId!),
    enabled: contentId !== null,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = draftId.trim();
    if (!UUID_RE.test(value)) {
      setContentId(null);
      setShapeError(new Error('Az id UUID legyen (a backend path-id szerződése szerint).'));
      return;
    }
    setShapeError(null);
    setContentId(value);
  }

  return (
    <section className="panel">
      <h2>Katalógus – publikus részlet</h2>
      <p className="muted">
        <code className="mono">GET /catalog/contents/:id</code> — csak jelenleg published tartalom; egyébként
        problem+json <code className="mono">404</code>. Login nem kell.
      </p>

      <form className="row" onSubmit={onSubmit}>
        <label className="grow" htmlFor={inputId}>
          Content UUID
          <input
            id={inputId}
            className="mono"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            placeholder="fbbf8b73-151f-4931-817c-f5a10a9f31ec"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit">Lekérés</button>
      </form>

      {shapeError ? <ProblemPanel error={shapeError} title="Kérés forma" /> : null}
      {query.isFetching ? <p className="muted">Betöltés…</p> : null}
      {query.isError ? <ProblemPanel error={query.error} title="Katalógus hiba" /> : null}
      {query.isSuccess ? (
        <div className="stack">
          <p className="muted">
            HTTP {query.data.status} · correlationId <span className="mono">{query.data.correlationId || '—'}</span>
          </p>
          <pre className="json">{JSON.stringify(query.data.data, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
