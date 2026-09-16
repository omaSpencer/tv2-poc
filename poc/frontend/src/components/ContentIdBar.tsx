import { useId, useState, type FormEvent } from 'react';
import { useActiveContent } from '../content/activeContentContext';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  hint?: string;
};

export function ContentIdBar({ hint }: Props) {
  const activeContent = useActiveContent();
  return (
    <ContentIdBarForm
      key={activeContent.contentId}
      contentId={activeContent.contentId}
      setContentId={activeContent.setContentId}
      hint={hint}
    />
  );
}

function ContentIdBarForm({
  contentId,
  setContentId,
  hint,
}: Props & { contentId: string; setContentId: (id: string) => void }) {
  const inputId = useId();
  const [draft, setDraft] = useState(contentId);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value.length > 0 && !UUID_RE.test(value)) {
      setError('UUID formátum kell (vagy hagyd üresen).');
      return;
    }
    setError(null);
    setContentId(value);
  }

  return (
    <form className="content-id-bar row" onSubmit={onSubmit}>
      <label className="grow" htmlFor={inputId}>
        Aktív content id
        <input
          id={inputId}
          className="mono"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          placeholder="után create/load kerül ide"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit">Beállít</button>
      {contentId ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setDraft('');
            setContentId('');
            setError(null);
          }}
        >
          Töröl
        </button>
      ) : null}
      {hint ? <p className="muted bar-hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
      {contentId && contentId !== draft.trim() ? (
        <p className="muted bar-hint">
          Mentett: <span className="mono">{contentId}</span>
        </p>
      ) : null}
    </form>
  );
}
