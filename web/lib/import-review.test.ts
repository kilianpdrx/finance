import { describe, it, expect } from 'vitest';
import { choicesForConfirm } from './import-review';

describe('import-review.ts', () => {
  it('keeps the choices of a row when the preview runs again for another account', () => {
    const forEur = [{ import_hash: 'a1', is_duplicate: false }, { import_hash: 'b1', is_duplicate: true }, { import_hash: 'c1', is_duplicate: true }];
    // Same file, another account: every hash changes, and row 2 is no longer a duplicate.
    const forChf = [{ import_hash: 'a2', is_duplicate: false }, { import_hash: 'b2', is_duplicate: true }, { import_hash: 'c2', is_duplicate: false }];
    const overrides = { 0: 7, 2: null };
    const force = new Set([1, 2]);
    expect(choicesForConfirm(forEur, overrides, force)).toEqual({ overrides: { a1: 7, c1: null }, force: ['b1', 'c1'] });
    expect(choicesForConfirm(forChf, overrides, force)).toEqual({ overrides: { a2: 7, c2: null }, force: ['b2'] });
  });
});
