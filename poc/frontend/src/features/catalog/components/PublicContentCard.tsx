import { Link } from 'react-router';
import type { PublicContentView } from '../../../api/types';
import { CATEGORY_LABELS, formatPublishedAt } from '../format';

type Props = {
  content: PublicContentView;
  fromCatalog: string;
};

export function PublicContentCard({ content, fromCatalog }: Props) {
  return (
    <article className="catalog-card">
      <p className="eyebrow">
        {content.category ? CATEGORY_LABELS[content.category] : 'Nincs kategória'}
      </p>
      <h3><Link to={`/catalog/${content.id}`} state={{ fromCatalog }}>{content.title}</Link></h3>
      <p>{content.summary ?? <span className="muted">Nincs elérhető összefoglaló.</span>}</p>
      {content.tags.length > 0 ? (
        <ul className="tag-list" aria-label="Címkék">
          {content.tags.map(tag => <li key={tag}>{tag}</li>)}
        </ul>
      ) : null}
      <p className="muted catalog-card-date" title={content.publishedAt ?? undefined}>
        {formatPublishedAt(content.publishedAt)}
      </p>
    </article>
  );
}
