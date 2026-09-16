import { describe, expect, it } from 'vitest';
import {
  emptyContentForm,
  isFormDirty,
  normalizeTags,
  publishMissing,
  toCreateContentBody,
  toPatchContentBody,
  validateContentForm,
  type ContentFormValues,
} from './schemas';

const valid: ContentFormValues = {
  title: '  Téli Őrség  ',
  slug: 'teli-orseg',
  summary: '  Összefoglaló  ',
  category: 'film',
  mediaAssetId: '  VOD-1  ',
  tags: ' Természet, tél, természet,  ',
};

describe('content form schema', () => {
  it('normalizes the create payload exactly like the backend contract', () => {
    expect(toCreateContentBody(valid)).toEqual({
      title: 'Téli Őrség',
      slug: 'teli-orseg',
      summary: 'Összefoglaló',
      category: 'film',
      mediaAssetId: 'VOD-1',
      tags: ['természet', 'tél'],
    });
    expect(normalizeTags(' A, a, B ')).toEqual(['a', 'b']);
  });

  it('reports every frontend limit without mutating input', () => {
    const errors = validateContentForm({
      ...valid,
      title: ' ',
      slug: 'Nem Jó',
      summary: 'x'.repeat(501),
      mediaAssetId: 'x'.repeat(129),
      tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`).join(','),
    });
    expect(Object.keys(errors).sort()).toEqual(['mediaAssetId', 'slug', 'summary', 'tags', 'title']);
  });

  it('builds a PATCH from normalized dirty fields only', () => {
    const baseline = { ...valid, title: 'Téli Őrség', tags: 'természet, tél' };
    expect(toPatchContentBody({ ...baseline, summary: 'Új összefoglaló' }, baseline, 7)).toEqual({
      expectedVersion: 7,
      summary: 'Új összefoglaló',
    });
    expect(toPatchContentBody({ ...baseline, title: ' Téli Őrség ' }, baseline, 7)).toEqual({ expectedVersion: 7 });
    expect(isFormDirty({ ...baseline, title: ' Téli Őrség ' }, baseline)).toBe(false);
  });

  it('separates publish readiness from form validity', () => {
    expect(validateContentForm(emptyContentForm())).toHaveProperty('title');
    expect(publishMissing({ ...valid, summary: '', mediaAssetId: '' })).toEqual(['összefoglaló', 'médiaazonosító']);
    expect(publishMissing(valid)).toEqual([]);
  });
});
