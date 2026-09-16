import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import type { ContentCategory } from '../../../api/types';
import { searchCatalog } from '../../../api/search';
import { CONTENT_CATEGORIES } from '../../../data/demoFixture';
import { CatalogSearchError } from '../components/CatalogSearchError';
import { PublicContentCard } from '../components/PublicContentCard';
import { CATEGORY_LABELS } from '../format';
import { catalogKeys } from '../queryKeys';
import {
  CATALOG_PAGE_LIMITS,
  MAX_CATALOG_OFFSET,
  parseCatalogSearchParams,
  serializeCatalogSearchParams,
  type CatalogSearchParams,
} from '../searchParams';

export function CatalogSearchPage() {
  const queryInputId = useId();
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const focusResultsAfterFetch = useRef(false);
  const location = useLocation();
  const [urlParams, setUrlParams] = useSearchParams();
  const rawUrlParams = urlParams.toString();
  const params = parseCatalogSearchParams(new URLSearchParams(rawUrlParams));
  const canonicalParams = serializeCatalogSearchParams(params).toString();
  const [draft, setDraft] = useState({ sourceQuery: params.q, value: params.q });
  const draftQuery = draft.sourceQuery === params.q ? draft.value : params.q;

  useEffect(() => {
    if (rawUrlParams !== canonicalParams) setUrlParams(canonicalParams, { replace: true });
  }, [canonicalParams, rawUrlParams, setUrlParams]);

  const search = useQuery({
    queryKey: catalogKeys.search(params),
    queryFn: () => searchCatalog(params.q, params),
    enabled: params.q.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    if (focusResultsAfterFetch.current && search.isSuccess && !search.isFetching) {
      focusResultsAfterFetch.current = false;
      resultHeading.current?.focus();
    }
  }, [search.isFetching, search.isSuccess]);

  function replaceParams(next: CatalogSearchParams, options?: { focusResults?: boolean }) {
    focusResultsAfterFetch.current = options?.focusResults ?? false;
    setUrlParams(serializeCatalogSearchParams(next));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    replaceParams({ ...params, q: draftQuery.trim().slice(0, 200), offset: 0 });
  }

  const data = search.data?.data;
  const returned = data?.returned ?? 0;
  const estimatedTotalHits = data?.estimatedTotalHits ?? 0;
  const expectedOnPage = Math.max(0, Math.min(params.limit, estimatedTotalHits - params.offset));
  const hasShortPage = search.isSuccess && returned < expectedOnPage;
  const previousOffset = Math.max(0, params.offset - params.limit);
  const nextOffset = params.offset + params.limit;
  const hasPrevious = params.offset > 0;
  const hasNext = search.isSuccess && nextOffset < estimatedTotalHits && nextOffset <= MAX_CATALOG_OFFSET;
  const fromCatalog = `${location.pathname}?${canonicalParams}`;

  return (
    <div className="stack-pages">
      <section className="panel catalog-hero">
        <p className="eyebrow">Publikus katalógus</p>
        <h2>Keress a műsorok között</h2>
        <p className="muted">A kereséshez nem szükséges bejelentkezés. A megosztott URL megőrzi a szűrőket és az oldalt.</p>
        <form className="catalog-search-form" onSubmit={onSubmit}>
          <label className="grow" htmlFor={queryInputId}>
            Keresett kifejezés
            <input
              id={queryInputId}
              value={draftQuery}
              onChange={event => setDraft({ sourceQuery: params.q, value: event.target.value })}
              placeholder="Például: őrség"
              maxLength={200}
            />
          </label>
          <label className="compact-field">
            Kategória
            <select
              aria-label="Kategória"
              value={params.category ?? ''}
              onChange={event => replaceParams({
                ...params,
                category: (event.target.value || null) as ContentCategory | null,
                offset: 0,
              })}
            >
              <option value="">Minden kategória</option>
              {CONTENT_CATEGORIES.map(category => (
                <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          <label className="compact-field">
            Találat oldalanként
            <select
              aria-label="Találat oldalanként"
              value={params.limit}
              onChange={event => replaceParams({
                ...params,
                limit: Number(event.target.value) as CatalogSearchParams['limit'],
                offset: 0,
              })}
            >
              {CATALOG_PAGE_LIMITS.map(limit => <option key={limit} value={limit}>{limit}</option>)}
            </select>
          </label>
          <button type="submit">Keresés</button>
        </form>
      </section>

      {!params.q ? (
        <section className="panel catalog-empty" role="status">
          <h2>Kezdj egy kereséssel</h2>
          <p className="muted">Írj be legalább egy karaktert a publikus tartalmak kereséséhez.</p>
        </section>
      ) : null}

      {params.q && search.isPending ? (
        <section className="panel" role="status" aria-label="Találatok betöltése">
          <div className="catalog-skeleton" />
          <div className="catalog-skeleton" />
          <div className="catalog-skeleton" />
        </section>
      ) : null}

      {search.isError ? (
        <CatalogSearchError
          error={search.error}
          onRetry={() => void search.refetch()}
          onReset={() => replaceParams({ q: '', category: null, limit: 20, offset: 0 })}
        />
      ) : null}

      {search.isSuccess && data ? (
        <section className="panel catalog-results" aria-busy={search.isFetching}>
          <div className="catalog-results-heading">
            <div>
              <p className="eyebrow">Találatok</p>
              <h2 ref={resultHeading} tabIndex={-1}>„{params.q}”</h2>
            </div>
            {search.isFetching ? <span className="muted" role="status">Frissítés…</span> : null}
          </div>
          <div className="catalog-result-counts" aria-live="polite">
            <strong>Az index becslése: {estimatedTotalHits}</strong>
            <span>Ezen az oldalon: {returned}</span>
          </div>
          {hasShortPage ? (
            <p className="note">Az oldal a becslésnél rövidebb: időközben visszavont vagy elavult indextalálatok kiestek a publikus adatbázis-ellenőrzésen.</p>
          ) : null}
          {data.items.length === 0 ? (
            <div className="catalog-empty" role="status">
              <h3>Nincs publikus találat</h3>
              <p className="muted">Próbálj másik kifejezést vagy kategóriát.</p>
            </div>
          ) : (
            <div className="catalog-grid">
              {data.items.map(content => (
                <PublicContentCard key={content.id} content={content} fromCatalog={fromCatalog} />
              ))}
            </div>
          )}
          <nav className="pagination" aria-label="Keresési találatok lapozása">
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasPrevious || search.isFetching}
              onClick={() => replaceParams({ ...params, offset: previousOffset }, { focusResults: true })}
            >Előző oldal</button>
            <span className="muted">
              {returned > 0 ? `${params.offset + 1}–${params.offset + returned}` : '0'}
            </span>
            <button
              type="button"
              className="btn-secondary"
              disabled={!hasNext || search.isFetching}
              onClick={() => replaceParams({ ...params, offset: nextOffset }, { focusResults: true })}
            >Következő oldal</button>
          </nav>
          {!hasNext && nextOffset > MAX_CATALOG_OFFSET && estimatedTotalHits > nextOffset ? (
            <p className="muted">A publikus keresés legfeljebb az 1000. offsetig lapozható.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
