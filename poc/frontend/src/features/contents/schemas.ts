import type { AdminContentView, ContentCategory, CreateContentBody, PatchContentBody } from '../../api/types';

export const CONTENT_FORM_LIMITS = {
  title: 200,
  slug: 80,
  summary: 500,
  mediaAssetId: 128,
  tagCount: 20,
  tagLength: 40,
} as const;

export const CONTENT_CATEGORIES: readonly ContentCategory[] = [
  'film', 'sorozat', 'hir', 'sport', 'szorakozas', 'egyeb',
];

export type ContentFormValues = {
  title: string;
  slug: string;
  summary: string;
  category: ContentCategory | '';
  mediaAssetId: string;
  tags: string;
};

export type ContentFormErrors = Partial<Record<keyof ContentFormValues, string>>;

export function emptyContentForm(): ContentFormValues {
  return { title: '', slug: '', summary: '', category: '', mediaAssetId: '', tags: '' };
}

export function contentToForm(content: AdminContentView): ContentFormValues {
  return {
    title: content.title,
    slug: content.slug ?? '',
    summary: content.summary ?? '',
    category: content.category ?? '',
    mediaAssetId: content.mediaAssetId ?? '',
    tags: content.tags.join(', '),
  };
}

export function normalizeTags(raw: string): string[] {
  return [...new Set(raw.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))];
}

export function validateContentForm(values: ContentFormValues): ContentFormErrors {
  const errors: ContentFormErrors = {};
  const title = values.title.trim();
  const slug = values.slug.trim();
  const summary = values.summary.trim();
  const mediaAssetId = values.mediaAssetId.trim();
  const tags = normalizeTags(values.tags);
  if (title.length < 1 || title.length > CONTENT_FORM_LIMITS.title) {
    errors.title = `A cím 1–${CONTENT_FORM_LIMITS.title} karakter lehet.`;
  }
  if (slug && (slug.length > CONTENT_FORM_LIMITS.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))) {
    errors.slug = 'A slug kisbetűt, számot és egyszeres kötőjelet tartalmazhat, legfeljebb 80 karakterben.';
  }
  if (summary.length > CONTENT_FORM_LIMITS.summary) errors.summary = 'Az összefoglaló legfeljebb 500 karakter lehet.';
  if (mediaAssetId.length > CONTENT_FORM_LIMITS.mediaAssetId) errors.mediaAssetId = 'A médiaazonosító legfeljebb 128 karakter lehet.';
  if (tags.length > CONTENT_FORM_LIMITS.tagCount || tags.some(tag => tag.length > CONTENT_FORM_LIMITS.tagLength)) {
    errors.tags = 'Legfeljebb 20, egyenként maximum 40 karakteres tag adható meg.';
  }
  return errors;
}

export function toCreateContentBody(values: ContentFormValues): CreateContentBody {
  return {
    title: values.title.trim(),
    slug: values.slug.trim() || null,
    summary: values.summary.trim() || null,
    category: values.category || null,
    mediaAssetId: values.mediaAssetId.trim() || null,
    tags: normalizeTags(values.tags),
  };
}

export function toPatchContentBody(
  values: ContentFormValues,
  baseline: ContentFormValues,
  expectedVersion: number,
): PatchContentBody {
  const current = toCreateContentBody(values);
  const previous = toCreateContentBody(baseline);
  const body: PatchContentBody = { expectedVersion };
  for (const field of ['title', 'slug', 'summary', 'category', 'mediaAssetId', 'tags'] as const) {
    const left = current[field];
    const right = previous[field];
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
        Object.assign(body, { [field]: left });
      }
    } else if (left !== right) {
      Object.assign(body, { [field]: left });
    }
  }
  return body;
}

export function isFormDirty(values: ContentFormValues, baseline: ContentFormValues): boolean {
  return Object.keys(toPatchContentBody(values, baseline, 1)).length > 1;
}

export function publishMissing(values: ContentFormValues): string[] {
  const body = toCreateContentBody(values);
  const missing: string[] = [];
  if (!body.title) missing.push('cím');
  if (!body.summary) missing.push('összefoglaló');
  if (!body.category) missing.push('kategória');
  if (!body.mediaAssetId) missing.push('médiaazonosító');
  return missing;
}
