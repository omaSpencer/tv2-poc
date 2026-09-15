import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { searchCatalog } from '../api/search';
import { isApiProblemError } from '../api/types';
import { useActiveContent } from '../content/activeContent';
import { DEMO_CONTENT } from '../data/demoFixture';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { ProblemPanel } from '../components/ProblemPanel';

export function SearchPage() {
  const inputId = useId();
  const { setContentId } = useActiveContent();
  const [draft, setDraft] = useState(DEMO_CONTENT.title.slice(0, 24));
  const [query, setQuery] = useState('');

  const search = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchCatalog(query),
    enabled: query.trim().length > 0,
    retry: false,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
  }

  const unavailable =
    search.isError &&
    isApiProblemError(search.error) &&
    (search.error.problem.code === 'search_unavailable' ||
      search.error.problem.code === 'dependency_unavailable' ||
      search.error.problem.status === 404 ||
      search.error.problem.status === 503);

  const items = search.data?.data.items ?? [];
  const total = search.data?.data.total;
  const truncated =
    search.data?.data.truncatedByDbFilter === true ||
    (typeof total === 'number' && items.length < total);

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Keresés (M4)</h2>
        <p className="muted">
          <code className="mono">GET /catalog/search?q=…</code> — login nélkül. Találatok DB-vel
          visszaellenőrizve; stale indexből származó visszavont találat kieshet → rövidebb oldal.
        </p>
        <p className="muted">
          DB-ben published ≠ azonnal kereshető (aszinkron indexelés).
        </p>

        <MilestoneGate
          milestone="M4"
          feature="Meilisearch + /catalog/search"
          detail="Amíg a kereső nincs bekötve, a hívás 404/503/problem+json lesz."
        />

        <form className="row" onSubmit={onSubmit}>
          <label className="grow" htmlFor={inputId}>
            Query
            <input
              id={inputId}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="őrség"
              minLength={1}
              maxLength={200}
            />
          </label>
          <button type="submit">Keresés</button>
        </form>
      </section>

      {unavailable ? (
        <MilestoneGate
          milestone="M4"
          feature="search_unavailable"
          detail="Mindkét index kiesése vagy a feature még nincs a backendben."
        />
      ) : null}

      {search.isError ? <ProblemPanel error={search.error} title="Keresés hiba" /> : null}

      {search.isSuccess ? (
        <section className="panel">
          <p className="muted">
            HTTP {search.data.status} · {items.length} találat
            {typeof total === 'number' ? ` / total ${total}` : ''} · correlationId{' '}
            <span className="mono">{search.data.correlationId || '—'}</span>
          </p>
          {truncated ? (
            <p className="note">
              A lista rövidebb lehet a nyers index-totalnál: a PoC a PostgreSQL publikálási
              állapotával szűr (stale találatok kiesnek).
            </p>
          ) : null}
          {items.length === 0 ? (
            <p className="muted">Nincs találat (vagy még nincs indexelve).</p>
          ) : (
            <ul className="hit-list">
              {items.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => setContentId(hit.id)}
                  >
                    {hit.title}
                  </button>
                  <span className="mono muted"> {hit.id}</span>
                  {' · '}
                  <Link to="/catalog">Catalog</Link>
                </li>
              ))}
            </ul>
          )}
          <JsonBlock value={search.data.data} label="Nyers válasz" />
        </section>
      ) : null}
    </div>
  );
}
