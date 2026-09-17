import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiProblemError } from '../../../api/types';
import { ProblemPanel } from '../../../components/ProblemPanel';
import { useNotifications } from '../../../components/notificationContext';
import { createContent } from '../api';
import { ContentForm } from '../components/ContentForm';
import { useDirtyGuard } from '../components/useDirtyGuard';
import {
  emptyContentForm,
  isFormDirty,
  toCreateContentBody,
  validateContentForm,
  type ContentFormErrors,
  type ContentFormValues,
} from '../schemas';
import { contentKeys } from '../queryKeys';

const EMPTY = emptyContentForm();

export function ContentCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const [values, setValues] = useState<ContentFormValues>(EMPTY);
  const [errors, setErrors] = useState<ContentFormErrors>({});
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  // Sikeres mentés után az űrlap már nem „nem mentett módosítás”: a guardnak
  // előbb le kell fegyverződnie, különben a saját navigációnkat blokkolná egy
  // félrevezető „elvesznek a módosítások” kérdéssel.
  const dirty = isFormDirty(values, EMPTY) && redirectTo === null;
  const confirmDiscard = useDirtyGuard(dirty);

  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true });
  }, [redirectTo, navigate]);

  const create = useMutation({
    mutationFn: () => createContent(toCreateContentBody(values)),
    retry: false,
    onSuccess: response => {
      queryClient.setQueryData(contentKeys.detail(response.data.id), response);
      void queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
      notify('A piszkozat létrejött.');
      setRedirectTo(`/contents/${response.data.id}`);
    },
    onError: error => {
      if (isApiProblemError(error) && error.problem.code === 'validation_failed') {
        const next: ContentFormErrors = {};
        for (const field of error.problem.fields ?? []) {
          if (field in values) next[field as keyof ContentFormValues] = 'A szerver elutasította ezt a mezőt.';
        }
        setErrors(next);
      }
      notify('A tartalom létrehozása nem sikerült.', 'error');
    },
  });

  function submit() {
    const next = validateContentForm(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate();
  }

  return (
    <div className="stack-pages">
      <section className="panel content-heading">
        <div><p className="eyebrow">Új piszkozat</p><h2>Tartalom létrehozása</h2></div>
        <button type="button" className="btn-secondary" onClick={() => {
          if (confirmDiscard()) navigate('/contents');
        }}>Mégse</button>
      </section>
      <section className="panel">
        <ContentForm
          values={values}
          errors={errors}
          disabled={create.isPending}
          submitLabel={create.isPending ? 'Létrehozás…' : 'Piszkozat létrehozása'}
          onChange={setValues}
          onSubmit={submit}
        />
      </section>
      {create.isError ? <ProblemPanel error={create.error} title="A piszkozat nem hozható létre" /> : null}
    </div>
  );
}
