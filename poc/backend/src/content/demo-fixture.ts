/**
 * M0-22 – the shared demo fixture and its negative counterparts. The M1 demo
 * runner and the integration tests use these same values so a documented run is
 * reproducible.
 */
export const DEMO_CONTENT = {
  title: 'Vadon élő Magyarország – Őrségi ősz',
  summary: 'Természetfilm az Őrség őszi élővilágáról.',
  category: 'film',
  mediaAssetId: 'vod-demo-0001',
  tags: ['természetfilm', 'őrség', 'ősz'],
} as const;

/** Generated inside the publish transaction from the title above. */
export const DEMO_SLUG = 'vadon-elo-magyarorszag-orsegi-osz';

export const DEMO_EDIT = {
  summary: 'Természetfilm az Őrség őszi élővilágáról, új vágással.',
  tags: ['természetfilm', 'őrség', 'ősz', 'vadon'],
} as const;

export const DEMO_WITHDRAWN_EDIT = {
  title: 'Vadon élő Magyarország – Őrségi ősz, bővített változat',
} as const;

export const NEGATIVE_CASES = {
  /** Publishing without a media asset id must fail the publish minimum. */
  missingMediaAsset: {
    title: DEMO_CONTENT.title,
    summary: DEMO_CONTENT.summary,
    category: DEMO_CONTENT.category,
  },
  /** 201 characters: one over the documented title limit. */
  tooLongTitle: 'A'.repeat(201),
  /** Two clients send the same expected version; exactly one may win. */
  conflictingExpectedVersion: 1,
  /** A title with no transliterable character cannot produce a slug. */
  unslugifiableTitle: '★★★',
} as const;
