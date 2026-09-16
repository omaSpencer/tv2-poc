import { useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { searchCatalog } from '../api/search';
import { isApiProblemError, type ContentCategory } from '../api/types';
import { useActiveContent } from '../content/activeContentContext';
import { CONTENT_CATEGORIES, DEMO_CONTENT } from '../data/demoFixture';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { ProblemPanel } from '../components/ProblemPanel';

export function SearchPage() {
  const inputId = useId();
  const { setContentId } = useActiveContent();
  const [draft, setDraft] = useState(DEMO_CONTENT.title.slice(0, 24));
  const [draftCategory, setDraftCategory] = useState<ContentCategory | ''>('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ContentCategory | null>(null);
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);

  const search = useQuery({
    queryKey: ['search', query, category, limit, offset],
    queryFn: () => searchCatalog(query, { category, limit, offset }),
    enabled: query.trim().length > 0,
    retry: false,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
    setCategory(draftCategory || null);
    setOffset(0);
  }

  const unavailable =
    search.isError &&
    isApiProblemError(search.error) &&
    (search.error.problem.code === 'search_unavailable' ||
      search.error.problem.code === 'dependency_unavailable' ||
      search.error.problem.status === 404 ||
      search.error.problem.status === 503);

  const items = search.data?.data.items ?? [];
  const returned = search.data?.data.returned ?? 0;
  const estimatedTotalHits = search.data?.data.estimatedTotalHits ?? 0;
  const expectedOnPage = Math.max(0, Math.min(limit, estimatedTotalHits - offset));
  const truncated = search.isSuccess && returned < expectedOnPage;
  const hasPrevious = offset > 0;
  const hasNext = search.isSuccess && offset + limit < estimatedTotalHits;

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
          <label className="compact-field">
            Kategória
            <select
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value as ContentCategory | '')}
            >
              <option value="">Mind</option>
              {CONTENT_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field">
            Találat / oldal
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
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
            HTTP {search.data.status} · {returned} visszaadott találat · becsült összes{' '}
            {estimatedTotalHits} · offset {search.data.data.offset} · correlationId{' '}
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
          <div className="row wrap-gap">
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasPrevious || search.isFetching}
              onClick={() => setOffset((current) => Math.max(0, current - limit))}
            >
              Előző oldal
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasNext || search.isFetching}
              onClick={() => setOffset((current) => current + limit)}
            >
              Következő oldal
            </button>
          </div>
          <JsonBlock value={search.data.data} label="Nyers válasz" />
        </section>
      ) : null}
    </div>
  );
}
