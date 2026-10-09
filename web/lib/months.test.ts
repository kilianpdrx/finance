import { describe, it, expect } from 'vitest';
import { MONTH_NAMES, splitMonth, joinMonth, addMonths, parseYear } from './months';

describe('months.ts', () => {
  it('names the twelve months', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('janvier');
    expect(MONTH_NAMES[11]).toBe('décembre');
  });

  it('splits and joins a month without losing it', () => {
    expect(splitMonth('2027-03')).toEqual({ year: 2027, month: 3 });
    expect(joinMonth(2027, 3)).toBe('2027-03');
    for (const ym of ['2026-01', '2026-12', '2031-07']) {
      const parts = splitMonth(ym)!;
      expect(joinMonth(parts.year, parts.month)).toBe(ym);
    }
  });

  it('refuses what is not a month', () => {
    expect(splitMonth('')).toBeNull();
    expect(splitMonth(null)).toBeNull();
    expect(splitMonth('2026-13')).toBeNull();
    expect(splitMonth('2026-00')).toBeNull();
    expect(splitMonth('2026-9')).toBeNull();
    expect(splitMonth('2026-09-01')).toBeNull();
  });

  it('adds months across years, in both directions', () => {
    expect(addMonths('2026-10', 12)).toBe('2027-10');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-05', 0)).toBe('2026-05');
    expect(addMonths('pas un mois', 2)).toBe('pas un mois');
  });

  it('reads a year only once it is complete', () => {
    expect(parseYear('2027')).toBe(2027);
    expect(parseYear(' 2027 ')).toBe(2027);
    expect(parseYear('202')).toBeNull();     // still being typed
    expect(parseYear('')).toBeNull();
    expect(parseYear('20270')).toBeNull();
    expect(parseYear('1800')).toBeNull();
    expect(parseYear('3000')).toBeNull();
  });
});
