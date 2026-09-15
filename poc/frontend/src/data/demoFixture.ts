/**
 * Mirror of backend/src/content/demo-fixture.ts for the playground.
 * Keep in sync by hand – the frontend does not import from the Nest package.
 */

export const DEMO_CONTENT = {
  title: 'Vadon élő Magyarország – Őrségi ősz',
  summary: 'Természetfilm az Őrség őszi élővilágáról.',
  category: 'film' as const,
  mediaAssetId: 'vod-demo-0001',
  tags: ['természetfilm', 'őrség', 'ősz'],
};

export const DEMO_SLUG = 'vadon-elo-magyarorszag-orsegi-osz';

export const DEMO_EDIT = {
  summary: 'Természetfilm az Őrség őszi élővilágáról, új vágással.',
  tags: ['természetfilm', 'őrség', 'ősz', 'vadon'],
};

export const DEMO_WITHDRAWN_EDIT = {
  title: 'Vadon élő Magyarország – Őrségi ősz, bővített változat',
};

export const NEGATIVE_CASES = {
  missingMediaAsset: {
    title: DEMO_CONTENT.title,
    summary: DEMO_CONTENT.summary,
    category: DEMO_CONTENT.category,
  },
  tooLongTitle: 'A'.repeat(201),
  conflictingExpectedVersion: 1,
  unslugifiableTitle: '★★★',
};

export const CONTENT_CATEGORIES = ['film', 'sorozat', 'hir', 'sport', 'szorakozas', 'egyeb'] as const;

export const ROLE_PERMISSIONS = {
  viewer: [] as const,
  editor: ['content:read', 'content:write'] as const,
  publisher: ['content:read', 'content:write', 'content:publish', 'ops:read'] as const,
} as const;

export type AppPermission = 'content:read' | 'content:write' | 'content:publish' | 'ops:read';
