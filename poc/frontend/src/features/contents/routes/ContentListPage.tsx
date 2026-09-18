import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../../auth/authContext';
import { can } from '../../../auth/permissions';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { listAdminContents } from '../api';
import { CONTENT_CATEGORIES } from '../schemas';
import { contentKeys } from '../queryKeys';
import { ContentStatusBadge } from '../components/ContentStatusBadge';
import { formatDateTime } from '../components/format';
import { cursorPaginationReducer, INITIAL_CURSOR_PAGINATION } from '../cursorPagination';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export function ContentListPage() {
  const { me } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const category = searchParams.get('category') ?? '';
  const debouncedQ = useDebouncedValue(q.trim(), 300);
  const [{ cursor, history }, dispatchPagination] = useReducer(
    cursorPaginationReducer,
    INITIAL_CURSOR_PAGINATION,
  );
  const filterSignature = `${q}\u0000${status}\u0000${category}`;
  const previousSignature = useRef(filterSignature);

  useEffect(() => {
    if (previousSignature.current === filterSignature) return;
    previousSignature.current = filterSignature;
    dispatchPagination({ type: 'reset' });
  }, [filterSignature]);

  const filters = useMemo(() => ({
    q: debouncedQ || undefined,
    status: status || undefined,
    category: category || undefined,
    limit: 20,
    cursor,
  }), [category, cursor, debouncedQ, status]);

  const list = useQuery({
    queryKey: contentKeys.list(filters),
    queryFn: () => listAdminContents(filters),
    placeholderData: keepPreviousData,
    retry: false,
  });

  function setFilter(name: 'q' | 'status' | 'category', value: string) {
    dispatchPagination({ type: 'reset' });
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    }, { replace: true });
  }

  function nextPage() {
    const next = list.data?.data.nextCursor;
    if (!next) return;
    dispatchPagination({ type: 'next', cursor: next });
  }

  function previousPage() {
    dispatchPagination({ type: 'previous' });
  }

  const items = list.data?.data.items ?? [];
  return (
    <div className="stack-pages">
      <section className="panel content-heading">
        <div>
          <p className="eyebrow">Szerkesztői workspace</p>
          <h2>Tartalmak</h2>
          <p className="muted">Stabil, cursoros lista. A szűrők az URL-ben megmaradnak.</p>
        </div>
        {can(me, 'content:write') ? <Link className="button-link" to="/contents/new">Új tartalom</Link> : null}
      </section>

      <section className="panel">
        <div className="content-filters">
          <label>
            Keresés cím, slug vagy pontos UUID alapján
            <input value={q} maxLength={200} onChange={event => setFilter('q', event.target.value)} />
          </label>
          <label>
            Státusz
            <select value={status} onChange={event => setFilter('status', event.target.value)}>
              <option value="">Minden státusz</option>
              <option value="draft">Piszkozat</option>
              <option value="published">Publikált</option>
              <option value="withdrawn">Visszavont</option>
            </select>
          </label>
          <label>
            Kategória
            <select value={category} onChange={event => setFilter('category', event.target.value)}>
              <option value="">Minden kategória</option>
              {CONTENT_CATEGORIES.map(value => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
        </div>
      </section>

      {list.isPending ? <section className="panel" role="status">Tartalmak betöltése…</section> : null}
      {list.isError ? (
        <div>
          <ProblemPanel error={list.error} title="A tartalomlista nem tölthető be" />
          <button type="button" onClick={() => void list.refetch()}>Újrapróbálás</button>
        </div>
      ) : null}
      {!list.isPending && !list.isError && items.length === 0 ? (
        <section className="panel"><h3>Nincs találat</h3><p className="muted">Módosítsd a szűrőket, vagy hozz létre új tartalmat.</p></section>
      ) : null}
      {items.length > 0 ? (
        <section className="panel content-list-panel" aria-busy={list.isFetching}>
          {list.isFetching && !list.isPending ? <p className="muted" role="status">Lista frissítése…</p> : null}
          <div className="content-table-wrap">
            <table className="content-table">
              <thead><tr><th>Cím</th><th>Státusz</th><th>Kategória</th><th>Verzió</th><th>Frissítve</th><th>Módosító</th></tr></thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td><Link to={`/contents/${item.id}`}>{item.title}</Link><small className="mono list-subline">{item.slug ?? item.id}</small></td>
                    <td><ContentStatusBadge status={item.status} /></td>
                    <td>{item.category ?? '—'}</td>
                    <td>{item.version}</td>
                    <td title={item.updatedAt}>{formatDateTime(item.updatedAt)}</td>
                    <td className="mono">{item.updatedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="content-card-list">
            {items.map(item => (
              <article className="content-card" key={item.id}>
                <h3><Link to={`/contents/${item.id}`}>{item.title}</Link></h3>
                <ContentStatusBadge status={item.status} />
                <dl className="kv compact-kv">
                  <div><dt>Kategória</dt><dd>{item.category ?? '—'}</dd></div>
                  <div><dt>Verzió</dt><dd>{item.version}</dd></div>
                  <div><dt>Frissítve</dt><dd title={item.updatedAt}>{formatDateTime(item.updatedAt)}</dd></div>
                  <div><dt>Módosító</dt><dd className="mono">{item.updatedBy}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          <nav className="pagination" aria-label="Tartalomlista lapozása">
            <button type="button" className="btn-secondary" disabled={history.length === 0 || list.isFetching} onClick={previousPage}>Előző</button>
            <span>{history.length + 1}. oldal</span>
            <button type="button" className="btn-secondary" disabled={!list.data?.data.nextCursor || list.isFetching} onClick={nextPage}>Következő</button>
          </nav>
        </section>
      ) : null}
    </div>
  );
}
