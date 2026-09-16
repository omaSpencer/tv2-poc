import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { fetchPublishedContent } from '../../../api/catalog';
import { isApiProblemError } from '../../../api/types';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { CATEGORY_LABELS, formatPublishedAt } from '../format';
import { catalogKeys } from '../queryKeys';

export function CatalogDetailError({ error, backToSearch }: { error: unknown; backToSearch: string }) {
  if (isApiProblemError(error) && error.problem.status === 404) {
    return (
      <section className="panel panel-punchline" role="status">
        <p className="eyebrow">404</p>
        <h2>Nem található vagy már nem publikus</h2>
        <p>A tartalom ismeretlen, vagy időközben visszavonták a katalógusból.</p>
        <Link className="button-link secondary" to={backToSearch}>Vissza a kereséshez</Link>
      </section>
    );
  }

  return (
    <div className="stack-pages">
      <ProblemPanel error={error} title="A publikus tartalom nem tölthető be" />
    </div>
  );
}

function previousSearch(locationState: unknown): string {
  if (!locationState || typeof locationState !== 'object' || !('fromCatalog' in locationState)) {
    return '/catalog/search';
  }
  const value = String(locationState.fromCatalog);
  return value.startsWith('/catalog/search') ? value : '/catalog/search';
}

export function CatalogDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const backToSearch = previousSearch(location.state);
  const detail = useQuery({
    queryKey: catalogKeys.detail(id),
    queryFn: () => fetchPublishedContent(id),
    enabled: Boolean(id),
    retry: false,
    throwOnError: false,
  });

  if (detail.isPending) {
    return <section className="panel" role="status">A publikus tartalom betöltése…</section>;
  }

  if (detail.isError) {
    return (
      <div className="stack-pages">
        <CatalogDetailError error={detail.error} backToSearch={backToSearch} />
        <p><button type="button" onClick={() => void detail.refetch()}>Újrapróbálás</button></p>
      </div>
    );
  }

  const content = detail.data.data;
  return (
    <article className="stack-pages">
      <section className="panel catalog-detail-heading">
        <div>
          <p className="eyebrow">{content.category ? CATEGORY_LABELS[content.category] : 'Publikus tartalom'}</p>
          <h2>{content.title}</h2>
          <p className="muted" title={content.publishedAt ?? undefined}>{formatPublishedAt(content.publishedAt)}</p>
        </div>
        <Link className="button-link secondary" to={backToSearch}>Vissza a kereséshez</Link>
      </section>
      <section className="panel catalog-detail-body">
        <h3>Összefoglaló</h3>
        <p>{content.summary ?? <span className="muted">Nincs elérhető összefoglaló.</span>}</p>
        {content.tags.length > 0 ? (
          <ul className="tag-list" aria-label="Címkék">
            {content.tags.map(tag => <li key={tag}>{tag}</li>)}
          </ul>
        ) : null}
      </section>
      <details className="panel">
        <summary>Technikai azonosító</summary>
        <dl className="kv top-gap">
          <div><dt>ID</dt><dd className="mono">{content.id}</dd></div>
          <div><dt>Slug</dt><dd className="mono">{content.slug ?? '—'}</dd></div>
        </dl>
      </details>
    </article>
  );
}
