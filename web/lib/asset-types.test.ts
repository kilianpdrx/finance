import { describe, it, expect } from 'vitest';
import {
  ASSET_TYPES,
  CASH_ASSET_TYPE,
  assetTypeLabel,
  assetTypeLabelPlural,
  isCashType,
} from './asset-types';

describe('asset types', () => {
  it('labels cash — the case the copied tables had diverged on', () => {
    // La revue d'import gardait sa propre table, sans `cash` : une ligne de
    // liquidités importée s'affichait « cash » au lieu de « Liquidités ».
    expect(assetTypeLabel('cash')).toBe('Liquidités');
    expect(assetTypeLabelPlural('cash')).toBe('Liquidités');
  });

  it('keeps singular and plural distinct where French needs it', () => {
    expect(assetTypeLabel('stock')).toBe('Action');
    expect(assetTypeLabelPlural('stock')).toBe('Actions');
    expect(assetTypeLabel('bond')).toBe('Obligation');
    expect(assetTypeLabelPlural('bond')).toBe('Obligations');
  });

  it('falls back to the raw value rather than rendering nothing', () => {
    expect(assetTypeLabel('warrant')).toBe('warrant');
    expect(assetTypeLabelPlural('warrant')).toBe('warrant');
  });

  it('maps the analytics catch-all bucket', () => {
    // `other` vient d'`allocation_by_type` côté backend : ce n'est pas un type
    // de position, il n'apparaît donc pas dans ASSET_TYPES. (TypeScript le sait
    // déjà grâce au `as const` — d'où le cast, sinon la comparaison est rejetée
    // comme impossible, ce qui est précisément la garantie recherchée.)
    expect(assetTypeLabelPlural('other')).toBe('Autre');
    expect(ASSET_TYPES.map((t) => t.value as string)).not.toContain('other');
  });

  it('every type has both forms', () => {
    for (const t of ASSET_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.plural.length).toBeGreaterThan(0);
    }
  });

  it('recognises cash, and nothing else', () => {
    expect(isCashType(CASH_ASSET_TYPE)).toBe(true);
    expect(isCashType('stock')).toBe(false);
    expect(isCashType(null)).toBe(false);
    expect(isCashType(undefined)).toBe(false);
  });
});
