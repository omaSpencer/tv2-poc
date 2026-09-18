import { describe, expect, it } from 'vitest';
import { isUuid } from './uuid';

const UUID_V4 = '123e4567-e89b-42d3-a456-426614174000';
const UUID_V7 = '018f1e2c-8b7a-7d3e-9c4b-1a2b3c4d5e6f';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

describe('uuid helper', () => {
  it('accepts backend-supported v1–v8 variant UUIDs including v7', () => {
    expect(isUuid(UUID_V4)).toBe(true);
    expect(isUuid(UUID_V7)).toBe(true);
  });

  it('rejects malformed and nil UUIDs', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(NIL_UUID)).toBe(false);
    expect(isUuid('123e4567-e89b-42d3-a456-42661417400')).toBe(false);
    expect(isUuid('123e4567-e89b-42d3-c456-426614174000')).toBe(false);
  });
});
