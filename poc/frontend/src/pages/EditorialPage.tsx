import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  createContent,
  getAdminContent,
  patchContent,
  publishContent,
  withdrawContent,
} from '../api/admin';
import { fetchMe } from '../api/me';
import type { ContentCategory, CreateContentBody } from '../api/types';
import { isApiProblemError } from '../api/types';
import { useAuthSession } from '../auth/session';
import { useActiveContent } from '../content/activeContent';
import { CONTENT_CATEGORIES, DEMO_CONTENT, DEMO_EDIT } from '../data/demoFixture';
import { can, PermissionHints } from '../components/PermissionHints';
import { ContentIdBar } from '../components/ContentIdBar';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { ProblemPanel } from '../components/ProblemPanel';

type FormState = {
  title: string;
  summary: string;
  category: ContentCategory | '';
  mediaAssetId: string;
  tags: string;
  slug: string;
};

function emptyForm(): FormState {
  return {
    title: DEMO_CONTENT.title,
    summary: DEMO_CONTENT.summary,
    category: DEMO_CONTENT.category,
    mediaAssetId: DEMO_CONTENT.mediaAssetId,
    tags: DEMO_CONTENT.tags.join(', '),
    slug: '',
  };
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export function EditorialPage() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuthSession();
  const { contentId, setContentId } = useActiveContent();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [lastError, setLastError] = useState<unknown>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [lastMeta, setLastMeta] = useState<{ status: number; correlationId: string } | null>(null);

  const me = useQuery({
    queryKey: ['me', accessToken],
    queryFn: () => fetchMe(accessToken!),
    enabled: Boolean(accessToken),
    retry: false,
  });

  const admin = useQuery({
    queryKey: ['admin-content', contentId, accessToken],
    queryFn: () => getAdminContent(contentId, accessToken!),
    enabled: Boolean(accessToken && contentId),
    retry: false,
  });

  useEffect(() => {
    if (!admin.data) return;
    const row = admin.data.data;
    setForm({
      title: row.title,
      summary: row.summary ?? '',
      category: row.category ?? '',
      mediaAssetId: row.mediaAssetId ?? '',
      tags: row.tags.join(', '),
      slug: row.slug ?? '',
    });
  }, [admin.data]);

  const meData = me.data?.data ?? null;
  const version = admin.data?.data.version;
  const canWrite = Boolean(accessToken) && can(meData, 'content:write');
  const canPublish = Boolean(accessToken) && can(meData, 'content:publish');
  const canRead = Boolean(accessToken) && can(meData, 'content:read');
  // Until /me works, still allow attempts so 503/401 surfaces in ProblemPanel.
  const allowAttempt = Boolean(accessToken);

  function onSuccessResult(status: number, correlationId: string, data: unknown) {
    setLastError(null);
    setLastResult(data);
    setLastMeta({ status, correlationId });
    void queryClient.invalidateQueries({ queryKey: ['admin-content'] });
    void queryClient.invalidateQueries({ queryKey: ['catalog-content'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    void queryClient.invalidateQueries({ queryKey: ['processing'] });
  }

  function onFail(error: unknown) {
    setLastResult(null);
    setLastMeta(null);
    setLastError(error);
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Nincs access token – Auth oldal.');
      const body: CreateContentBody = {
        title: form.title,
        summary: form.summary || null,
        category: (form.category || null) as ContentCategory | null,
        mediaAssetId: form.mediaAssetId || null,
        tags: parseTags(form.tags),
      };
      if (form.slug.trim()) body.slug = form.slug.trim();
      return createContent(body, accessToken);
    },
    onSuccess: (res) => {
      setContentId(res.data.id);
      onSuccessResult(res.status, res.correlationId, res.data);
    },
    onError: onFail,
  });

  const loadMut = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Nincs access token.');
      if (!contentId) throw new Error('Nincs content id.');
      return getAdminContent(contentId, accessToken);
    },
    onSuccess: (res) => onSuccessResult(res.status, res.correlationId, res.data),
    onError: onFail,
  });

  const patchMut = useMutation({
    mutationFn: async () => {
      if (!accessToken || !contentId || version === undefined) {
        throw new Error('Token, content id és betöltött version kell.');
      }
      return patchContent(
        contentId,
        {
          expectedVersion: version,
          title: form.title,
          summary: form.summary || null,
          category: (form.category || null) as ContentCategory | null,
          mediaAssetId: form.mediaAssetId || null,
          tags: parseTags(form.tags),
          slug: form.slug.trim() ? form.slug.trim() : null,
        },
        accessToken,
      );
    },
    onSuccess: (res) => onSuccessResult(res.status, res.correlationId, res.data),
    onError: onFail,
  });

  const publishMut = useMutation({
    mutationFn: async () => {
      if (!accessToken || !contentId || version === undefined) {
        throw new Error('Token, content id és version kell.');
      }
      return publishContent(contentId, { expectedVersion: version }, accessToken);
    },
    onSuccess: (res) => onSuccessResult(res.status, res.correlationId, res.data),
    onError: onFail,
  });

  const withdrawMut = useMutation({
    mutationFn: async () => {
      if (!accessToken || !contentId || version === undefined) {
        throw new Error('Token, content id és version kell.');
      }
      return withdrawContent(contentId, { expectedVersion: version }, accessToken);
    },
    onSuccess: (res) => onSuccessResult(res.status, res.correlationId, res.data),
    onError: onFail,
  });

  const busy =
    createMut.isPending ||
    loadMut.isPending ||
    patchMut.isPending ||
    publishMut.isPending ||
    withdrawMut.isPending;

  const identityBlocked =
    lastError &&
    isApiProblemError(lastError) &&
    lastError.problem.code === 'dependency_unavailable';

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Szerkesztői munkalap</h2>
        <p className="muted">
          <code className="mono">POST/PATCH/GET /admin/contents</code>, publish/withdraw +{' '}
          <code className="mono">expectedVersion</code>. Mezők a mintafixture értékeivel.
        </p>
        <ContentIdBar hint="Create után automatikusan kitöltődik." />
        {!accessToken ? (
          <MilestoneGate
            milestone="M2"
            feature="Admin API"
            detail="Nincs Bearer token. Auth oldalon ments tokent, vagy várd meg a PKCE-t."
          />
        ) : null}
        {identityBlocked ? (
          <MilestoneGate
            milestone="M2"
            feature="/admin"
            detail="dependency_unavailable – identity off a backendben."
          />
        ) : null}

        <div className="row wrap-gap">
          <button type="button" className="btn-secondary" onClick={() => setForm(emptyForm())}>
            Fixture betöltése
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setForm((f) => ({
                ...f,
                summary: DEMO_EDIT.summary,
                tags: DEMO_EDIT.tags.join(', '),
              }))
            }
          >
            DEMO_EDIT mezők
          </button>
        </div>

        <div className="form-grid">
          <label>
            title
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label>
            summary
            <textarea
              rows={3}
              value={form.summary}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
          </label>
          <label>
            category
            <select
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({ ...f, category: e.target.value as ContentCategory | '' }))
              }
            >
              <option value="">—</option>
              {CONTENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            mediaAssetId
            <input
              className="mono"
              value={form.mediaAssetId}
              onChange={(e) => setForm((f) => ({ ...f, mediaAssetId: e.target.value }))}
            />
          </label>
          <label>
            tags (vesszővel)
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            />
          </label>
          <label>
            slug (opcionális)
            <input
              className="mono"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            />
          </label>
        </div>

        <p className="muted">
          Státusz:{' '}
          <span className="mono">{admin.data?.data.status ?? '—'}</span> · version{' '}
          <span className="mono">{version ?? '—'}</span>
          {meData ? (
            <>
              {' '}
              · role <span className="mono">{meData.roles.join('+') || 'none'}</span>
            </>
          ) : null}
        </p>

        <div className="row wrap-gap">
          <button
            type="button"
            disabled={busy || !allowAttempt || (meData !== null && !canWrite)}
            onClick={() => createMut.mutate()}
            title={!canWrite && meData ? 'content:write kell' : undefined}
          >
            Create draft
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !allowAttempt || !contentId || (meData !== null && !canRead)}
            onClick={() => loadMut.mutate()}
          >
            Load admin
          </button>
          <button
            type="button"
            disabled={busy || !allowAttempt || !contentId || version === undefined || (meData !== null && !canWrite)}
            onClick={() => patchMut.mutate()}
          >
            Patch
          </button>
          <button
            type="button"
            disabled={
              busy || !allowAttempt || !contentId || version === undefined || (meData !== null && !canPublish)
            }
            onClick={() => publishMut.mutate()}
            title={!canPublish && meData ? 'content:publish kell' : undefined}
          >
            Publish
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={
              busy || !allowAttempt || !contentId || version === undefined || (meData !== null && !canPublish)
            }
            onClick={() => withdrawMut.mutate()}
          >
            Withdraw
          </button>
        </div>
      </section>

      {admin.isError && !lastError ? <ProblemPanel error={admin.error} title="Admin GET hiba" /> : null}
      {lastError ? <ProblemPanel error={lastError} title="Művelet hiba" /> : null}
      {lastResult ? (
        <section className="panel">
          <h3>Utolsó válasz</h3>
          {lastMeta ? (
            <p className="muted">
              HTTP {lastMeta.status} · correlationId{' '}
              <span className="mono">{lastMeta.correlationId || '—'}</span>
            </p>
          ) : null}
          <JsonBlock value={lastResult} />
        </section>
      ) : null}

      <section className="panel panel-muted">
        <PermissionHints me={meData} />
      </section>
    </div>
  );
}
