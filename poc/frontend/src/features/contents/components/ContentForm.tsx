import { useId, type FormEvent } from 'react';
import {
  CONTENT_CATEGORIES,
  CONTENT_FORM_LIMITS,
  normalizeTags,
  type ContentFormErrors,
  type ContentFormValues,
} from '../schemas';

type Props = {
  values: ContentFormValues;
  errors: ContentFormErrors;
  disabled?: boolean;
  submitLabel: string;
  onChange: (values: ContentFormValues) => void;
  onSubmit: () => void;
};

export function ContentForm({ values, errors, disabled = false, submitLabel, onChange, onSubmit }: Props) {
  const prefix = useId();
  const tags = normalizeTags(values.tags);
  function set<K extends keyof ContentFormValues>(field: K, value: ContentFormValues[K]) {
    onChange({ ...values, [field]: value });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  const describedBy = (field: keyof ContentFormValues) => errors[field] ? `${prefix}-${field}-error` : undefined;

  return (
    <form className="content-form" onSubmit={submit} noValidate>
      <fieldset disabled={disabled}>
        <legend>Tartalmi adatok</legend>
        <div className="form-grid">
          <label htmlFor={`${prefix}-title`}>
            Cím <span aria-hidden="true">*</span>
            <input
              id={`${prefix}-title`}
              value={values.title}
              maxLength={CONTENT_FORM_LIMITS.title}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={describedBy('title')}
              onChange={event => set('title', event.target.value)}
            />
            <small>{values.title.length}/{CONTENT_FORM_LIMITS.title}</small>
            {errors.title ? <span id={`${prefix}-title-error`} className="field-error">{errors.title}</span> : null}
          </label>

          <label htmlFor={`${prefix}-slug`}>
            Slug <span className="muted">(opcionális; publikáláskor generálható)</span>
            <input
              id={`${prefix}-slug`}
              className="mono"
              value={values.slug}
              maxLength={CONTENT_FORM_LIMITS.slug}
              aria-invalid={Boolean(errors.slug)}
              aria-describedby={describedBy('slug')}
              onChange={event => set('slug', event.target.value)}
            />
            <small>{values.slug.length}/{CONTENT_FORM_LIMITS.slug}</small>
            {errors.slug ? <span id={`${prefix}-slug-error`} className="field-error">{errors.slug}</span> : null}
          </label>

          <label htmlFor={`${prefix}-summary`} className="form-span">
            Összefoglaló
            <textarea
              id={`${prefix}-summary`}
              rows={5}
              value={values.summary}
              maxLength={CONTENT_FORM_LIMITS.summary}
              aria-invalid={Boolean(errors.summary)}
              aria-describedby={describedBy('summary')}
              onChange={event => set('summary', event.target.value)}
            />
            <small>{values.summary.length}/{CONTENT_FORM_LIMITS.summary}</small>
            {errors.summary ? <span id={`${prefix}-summary-error`} className="field-error">{errors.summary}</span> : null}
          </label>

          <label htmlFor={`${prefix}-category`}>
            Kategória
            <select
              id={`${prefix}-category`}
              value={values.category}
              aria-invalid={Boolean(errors.category)}
              aria-describedby={describedBy('category')}
              onChange={event => set('category', event.target.value as ContentFormValues['category'])}
            >
              <option value="">— nincs megadva —</option>
              {CONTENT_CATEGORIES.map(category => <option value={category} key={category}>{category}</option>)}
            </select>
            {errors.category ? <span id={`${prefix}-category-error`} className="field-error">{errors.category}</span> : null}
          </label>

          <label htmlFor={`${prefix}-media`}>
            Médiaazonosító
            <input
              id={`${prefix}-media`}
              className="mono"
              value={values.mediaAssetId}
              maxLength={CONTENT_FORM_LIMITS.mediaAssetId}
              aria-invalid={Boolean(errors.mediaAssetId)}
              aria-describedby={describedBy('mediaAssetId')}
              onChange={event => set('mediaAssetId', event.target.value)}
            />
            <small>{values.mediaAssetId.length}/{CONTENT_FORM_LIMITS.mediaAssetId}</small>
            {errors.mediaAssetId ? <span id={`${prefix}-mediaAssetId-error`} className="field-error">{errors.mediaAssetId}</span> : null}
          </label>

          <label htmlFor={`${prefix}-tags`} className="form-span">
            Tagek <span className="muted">(vesszővel elválasztva)</span>
            <input
              id={`${prefix}-tags`}
              value={values.tags}
              aria-invalid={Boolean(errors.tags)}
              aria-describedby={describedBy('tags')}
              onChange={event => set('tags', event.target.value)}
            />
            <small>{tags.length}/{CONTENT_FORM_LIMITS.tagCount} normalizált tag: {tags.join(', ') || '—'}</small>
            {errors.tags ? <span id={`${prefix}-tags-error`} className="field-error">{errors.tags}</span> : null}
          </label>
        </div>
        <div className="row top-gap">
          <button type="submit" disabled={disabled}>{submitLabel}</button>
        </div>
      </fieldset>
    </form>
  );
}
