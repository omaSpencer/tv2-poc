import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { fetchPublishedContent } from '../api/catalog';
import { isApiProblemError } from '../api/types';
import { useActiveContent } from '../content/activeContentContext';
import { ContentIdBar } from '../components/ContentIdBar';
import { JsonBlock } from '../components/JsonBlock';
import { ProblemPanel } from '../components/ProblemPanel';

export function CatalogPage() {
  const { id } = useParams();
  const { contentId: activeContentId } = useActiveContent();
  const contentId = id ?? activeContentId;

  const query = useQuery({
    queryKey: ['catalog-content', contentId],
    queryFn: () => fetchPublishedContent(contentId),
    enabled: Boolean(contentId),
    retry: false,
  });

  const notPublished =
    query.isError &&
    isApiProblemError(query.error) &&
    (query.error.problem.status === 404 || query.error.problem.code === 'content_not_found');

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Katalógus – publikus részlet</h2>
        <p className="muted">
          <code className="mono">GET /catalog/contents/:id</code> — csak published; egyébként 404.
          Login nem kell. Visszavonás után ez a demó punchline.
        </p>
        {!id ? <ContentIdBar /> : null}
        {!contentId ? <p className="muted">Állíts be egy content UUID-t fent.</p> : null}
        {query.isFetching ? <p className="muted">Betöltés…</p> : null}
      </section>

      {notPublished ? (
        <aside className="panel panel-punchline" role="status">
          <h3>404 – nem publikus</h3>
          <p>
            A tartalom nincs published állapotban (vagy az id ismeretlen). Admin oldalon még
            látszódhat; a nézői részlet nem.
          </p>
        </aside>
      ) : null}

      {query.isError ? <ProblemPanel error={query.error} title="Katalógus hiba" /> : null}
      {query.isSuccess ? (
        <section className="panel">
          <p className="muted">
            HTTP {query.data.status} · correlationId{' '}
            <span className="mono">{query.data.correlationId || '—'}</span>
          </p>
          <JsonBlock value={query.data.data} />
        </section>
      ) : null}
    </div>
  );
}
