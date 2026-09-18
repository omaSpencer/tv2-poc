import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { isApiProblemError, type AdminContentView, type PatchContentBody, type ProblemDocument } from '../../../api/types';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { useNotifications } from '../../../components/notificationContext';
import { getAdminContent, patchContent } from '../api';
import { ContentConflictDialog } from '../components/ContentConflictDialog';
import { ContentForm } from '../components/ContentForm';
import { useDirtyNavigationGuard } from '../../../navigation/useDirtyNavigationGuard';
import {
  contentToForm,
  isFormDirty,
  toPatchContentBody,
  validateContentForm,
  type ContentFormErrors,
  type ContentFormValues,
} from '../schemas';
import { contentKeys } from '../queryKeys';

type Conflict = { problem: ProblemDocument; server: AdminContentView; localPatch: PatchContentBody };

export function ContentEditPage() {
  const { id = '' } = useParams();
  const detail = useQuery({
    queryKey: contentKeys.detail(id),
    queryFn: () => getAdminContent(id),
    enabled: Boolean(id),
    retry: false,
  });
  if (detail.isPending) return <section className="panel" role="status">Szerkesztő betöltése…</section>;
  if (detail.isError) return <ProblemPanel error={detail.error} title="A tartalom nem tölthető be" />;
  if (detail.data.data.status === 'published') {
    return <Navigate to={`/contents/${id}`} replace state={{ notice: 'A publikált tartalom csak olvasható. Vond vissza a szerkesztéshez.' }} />;
  }
  return <EditWorkspace key={id} initial={detail.data.data} />;
}

function EditWorkspace({ initial }: { initial: AdminContentView }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const [baselineContent, setBaselineContent] = useState(initial);
  const [baseline, setBaseline] = useState<ContentFormValues>(() => contentToForm(initial));
  const [values, setValues] = useState<ContentFormValues>(() => contentToForm(initial));
  const [errors, setErrors] = useState<ContentFormErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [redirect, setRedirect] = useState<{ to: string; notice?: string } | null>(null);
  // Amíg a saját átirányításunk függőben van, az űrlap nem számít mentetlennek:
  // enélkül a dirty guard a sikeres feloldás után is rákérdezne az adatvesztésre.
  const dirty = isFormDirty(values, baseline) && redirect === null;
  useDirtyNavigationGuard(dirty);

  useEffect(() => {
    if (!redirect) return;
    navigate(redirect.to, {
      replace: true,
      ...(redirect.notice ? { state: { notice: redirect.notice } } : {}),
    });
  }, [redirect, navigate]);
  const id = initial.id;

  const patch = useMutation({
    mutationFn: (body: PatchContentBody) => patchContent(id, body),
    retry: false,
    onSuccess: response => {
      const wasNoOp = response.data.version === baselineContent.version;
      const next = contentToForm(response.data);
      setBaselineContent(response.data);
      setBaseline(next);
      setValues(next);
      setErrors({});
      queryClient.setQueryData(contentKeys.detail(id), response);
      void queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: contentKeys.auditRoot(id) });
      notify(wasNoOp ? 'Nem volt mentendő változás; a verzió nem módosult.' : 'A módosítások elmentve.');
    },
    onError: async (error, localPatch) => {
      if (isApiProblemError(error) && error.problem.code === 'version_conflict') {
        try {
          const current = await getAdminContent(id);
          setConflict({ problem: error.problem, server: current.data, localPatch });
          return;
        } catch {
          // The original conflict stays visible when the refresh also fails.
        }
      }
      if (isApiProblemError(error) && error.problem.code === 'validation_failed') {
        const next: ContentFormErrors = {};
        for (const field of error.problem.fields ?? []) {
          if (field in values) next[field as keyof ContentFormValues] = 'A szerver elutasította ezt a mezőt.';
        }
        setErrors(next);
      }
      notify('A mentés nem sikerült.', 'error');
    },
  });

  function submit() {
    const next = validateContentForm(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const body = toPatchContentBody(values, baseline, baselineContent.version);
    if (Object.keys(body).length === 1) {
      notify('Nincs mentendő változás.');
      return;
    }
    patch.mutate(body);
  }

  function loadServer() {
    if (!conflict) return;
    const next = contentToForm(conflict.server);
    setBaselineContent(conflict.server);
    setBaseline(next);
    setValues(next);
    setConflict(null);
    queryClient.setQueryData(contentKeys.detail(id), { data: conflict.server, status: 200, correlationId: '' });
    if (conflict.server.status === 'published') setRedirect({ to: `/contents/${id}` });
  }

  function keepLocal() {
    if (!conflict) return;
    queryClient.setQueryData(contentKeys.detail(id), { data: conflict.server, status: 200, correlationId: '' });
    if (conflict.server.status === 'published') {
      setRedirect({
        to: `/contents/${id}`,
        notice: 'A tartalom időközben publikált lett; a helyi draft nem írható rá.',
      });
      return;
    }
    const nextBaseline = contentToForm(conflict.server);
    const merged = { ...nextBaseline };
    for (const [field, value] of Object.entries(conflict.localPatch)) {
      if (field === 'expectedVersion') continue;
      if (field === 'tags') merged.tags = Array.isArray(value) ? value.join(', ') : '';
      else if (field in merged) Object.assign(merged, { [field]: value ?? '' });
    }
    setBaselineContent(conflict.server);
    setBaseline(nextBaseline);
    setValues(merged);
    setConflict(null);
    notify('A helyi módosítások az új szerververzióra kerültek. Mentéshez ellenőrizd és küldd el újra.');
  }

  return (
    <div className="stack-pages">
      <section className="panel content-heading">
        <div><p className="eyebrow">Szerkesztés · v{baselineContent.version}</p><h2>{baselineContent.title}</h2></div>
        <button type="button" className="btn-secondary" onClick={() => navigate(`/contents/${id}`)}>Mégse</button>
      </section>
      <section className="panel">
        <ContentForm
          values={values}
          errors={errors}
          disabled={patch.isPending}
          submitLabel={patch.isPending ? 'Mentés…' : 'Módosítások mentése'}
          onChange={setValues}
          onSubmit={submit}
        />
      </section>
      {patch.isError && !conflict ? <ProblemPanel error={patch.error} title="A módosítás nem menthető" /> : null}
      {conflict ? <ContentConflictDialog {...conflict} onLoadServer={loadServer} onKeepLocal={keepLocal} /> : null}
    </div>
  );
}
