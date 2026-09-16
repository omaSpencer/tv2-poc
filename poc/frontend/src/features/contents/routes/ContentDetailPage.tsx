import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../../../auth/authContext';
import { can, permissionReason } from '../../../auth/permissions';
import { isApiProblemError } from '../../../api/types';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { useNotifications } from '../../../components/notificationContext';
import { getAdminContent, publishContent, withdrawContent } from '../api';
import { AuditTimeline } from '../components/AuditTimeline';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContentStatusBadge } from '../components/ContentStatusBadge';
import { formatDateTime } from '../components/format';
import { contentKeys } from '../queryKeys';
import { contentToForm, publishMissing } from '../schemas';

export function ContentDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { me } = useAuth();
  const { notify } = useNotifications();
  const queryClient = useQueryClient();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const detail = useQuery({
    queryKey: contentKeys.detail(id),
    queryFn: () => getAdminContent(id),
    enabled: Boolean(id),
    retry: false,
  });

  function accept(response: Awaited<ReturnType<typeof publishContent>>, message: string) {
    queryClient.setQueryData(contentKeys.detail(id), response);
    void queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: contentKeys.auditRoot(id) });
    notify(message);
  }

  const publish = useMutation({
    mutationFn: (version: number) => publishContent(id, { expectedVersion: version }),
    retry: false,
    onSuccess: response => accept(response, 'A tartalom publikálva lett.'),
    onError: () => notify('A publikálás nem sikerült.', 'error'),
  });
  const withdraw = useMutation({
    mutationFn: (version: number) => withdrawContent(id, { expectedVersion: version }),
    retry: false,
    onSuccess: response => {
      setConfirmWithdraw(false);
      accept(response, 'A tartalom vissza lett vonva.');
    },
    onError: () => notify('A visszavonás nem sikerült.', 'error'),
  });

  if (detail.isPending) return <section className="panel" role="status">Tartalom betöltése…</section>;
  if (detail.isError) return <ProblemPanel error={detail.error} title="A tartalom nem tölthető be" />;
  const content = detail.data.data;
  const editable = content.status !== 'published';
  const missing = publishMissing(contentToForm(content));
  const canWrite = can(me, 'content:write');
  const canPublish = can(me, 'content:publish');
  const lifecycleBusy = publish.isPending || withdraw.isPending;

  return (
    <div className="stack-pages">
      {location.state && typeof location.state === 'object' && 'notice' in location.state ? (
        <section className="panel panel-muted" role="status">{String(location.state.notice)}</section>
      ) : null}
      <section className="panel content-heading">
        <div>
          <p className="eyebrow">Tartalom részletei</p>
          <h2>{content.title}</h2>
          <p><ContentStatusBadge status={content.status} /> · <span className="mono">v{content.version}</span></p>
        </div>
        <div className="row">
          <Link className="button-link secondary" to="/contents">Vissza a listához</Link>
          {editable && canWrite ? <Link className="button-link" to={`/contents/${id}/edit`}>Szerkesztés</Link> : null}
        </div>
      </section>

      <section className="panel detail-grid">
        <div><h3>Leírás</h3><p>{content.summary ?? <span className="muted">Nincs összefoglaló.</span>}</p></div>
        <dl className="kv">
          <div><dt>Slug</dt><dd className="mono">{content.slug ?? 'publikáláskor generálódik'}</dd></div>
          <div><dt>Kategória</dt><dd>{content.category ?? '—'}</dd></div>
          <div><dt>Médiaazonosító</dt><dd className="mono">{content.mediaAssetId ?? '—'}</dd></div>
          <div><dt>Tagek</dt><dd>{content.tags.join(', ') || '—'}</dd></div>
          <div><dt>Frissítve</dt><dd title={content.updatedAt}>{formatDateTime(content.updatedAt)}</dd></div>
          <div><dt>Módosító</dt><dd className="mono">{content.updatedBy}</dd></div>
          <div><dt>Publikálva</dt><dd title={content.publishedAt ?? undefined}>{formatDateTime(content.publishedAt)}</dd></div>
          <div><dt>Visszavonva</dt><dd title={content.withdrawnAt ?? undefined}>{formatDateTime(content.withdrawnAt)}</dd></div>
        </dl>
      </section>

      <section className="panel">
        <h2>Publikálási készenlét</h2>
        {missing.length === 0 ? <p className="success-text">Minden kötelező mező rendelkezésre áll.</p> : (
          <p className="field-error">Hiányzik: {missing.join(', ')}.</p>
        )}
        {!content.slug ? <p className="muted">A slug a címből automatikusan generálódik az első publikáláskor.</p> : null}
        <div className="row">
          {content.status !== 'published' ? (
            <button
              type="button"
              disabled={lifecycleBusy || !canPublish || missing.length > 0}
              title={!canPublish ? permissionReason(me, 'content:publish') : missing.length > 0 ? 'A publikálási minimum nem teljes.' : undefined}
              onClick={() => publish.mutate(content.version)}
            >{content.status === 'withdrawn' ? 'Újrapublikálás' : 'Publikálás'}</button>
          ) : (
            <button
              type="button"
              className="btn-danger"
              disabled={lifecycleBusy || !canPublish}
              title={permissionReason(me, 'content:publish')}
              onClick={() => setConfirmWithdraw(true)}
            >Visszavonás</button>
          )}
          {content.status === 'published' ? <Link to={`/catalog/${id}`} target="_blank">Publikus nézet megnyitása</Link> : null}
        </div>
        {!canPublish ? <p className="muted">A lifecycle műveletekhez content:publish jogosultság szükséges.</p> : null}
      </section>

      {publish.isError ? <ProblemPanel error={publish.error} title="Publikálási hiba" /> : null}
      {publish.isError && isApiProblemError(publish.error) && publish.error.problem.code === 'validation_failed' && canWrite ? (
        <p><Link to={`/contents/${id}/edit`}>A hiányzó mezők javítása a szerkesztőben</Link></p>
      ) : null}
      {withdraw.isError ? <ProblemPanel error={withdraw.error} title="Visszavonási hiba" /> : null}

      <details className="panel"><summary>Technikai mezők</summary><dl className="kv top-gap">
        <div><dt>ID</dt><dd className="mono">{content.id}</dd></div>
        <div><dt>Létrehozva</dt><dd title={content.createdAt}>{formatDateTime(content.createdAt)}</dd></div>
        <div><dt>Létrehozó</dt><dd className="mono">{content.createdBy}</dd></div>
      </dl></details>

      <AuditTimeline contentId={id} />
      {confirmWithdraw ? (
        <ConfirmDialog
          title="Tartalom visszavonása"
          confirmLabel="Visszavonás"
          busy={withdraw.isPending}
          onCancel={() => setConfirmWithdraw(false)}
          onConfirm={() => withdraw.mutate(content.version)}
        ><p>Biztosan visszavonod ezt a tartalmat: <strong>{content.title}</strong>?</p></ConfirmDialog>
      ) : null}
    </div>
  );
}
