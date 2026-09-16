import assert from 'node:assert/strict';

/** Compare every demo fixture with its expected database projection on both sides. */
export function assertFixtureState(expected, actualA, actualB) {
  assert.deepStrictEqual(actualA, expected, 'Index A differs from the expected demo fixture state');
  assert.deepStrictEqual(actualB, expected, 'Index B differs from the expected demo fixture state');
}
