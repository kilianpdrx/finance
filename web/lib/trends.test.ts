import { describe, it, expect } from 'vitest';
import { trendGranularity, totalSeries, periodTick, periodLabel } from './trends';

describe('trends.ts', () => {
  describe('trendGranularity', () => {
    it('shows a short range day by day', () => {
      expect(trendGranularity('2026-09-01', '2026-09-30')).toBe('day');
      expect(trendGranularity('2026-08-01', '2026-09-30')).toBe('day');   // 61 days
    });

    it('keeps months for longer or open-ended ranges', () => {
      expect(trendGranularity('2026-07-01', '2026-09-30')).toBe('month');
      expect(trendGranularity('2026-01-01', '2026-12-31')).toBe('month');
      expect(trendGranularity('', '')).toBe('month');
      expect(trendGranularity(undefined, '2026-09-30')).toBe('month');
    });

    it('does not trust an inverted range', () => {
      expect(trendGranularity('2026-09-30', '2026-09-01')).toBe('month');
    });
  });

  describe('totalSeries', () => {
    it('sums the categories per period and accumulates in order', () => {
      const points = totalSeries([
        { series: [{ period: '2026-09-02', amount_cents: 300 }, { period: '2026-09-01', amount_cents: 1000 }] },
        { series: [{ period: '2026-09-01', amount_cents: 500 }, { period: '2026-09-03', amount_cents: 0 }] },
      ]);
      expect(points).toEqual([
        { period: '2026-09-01', total: 1500, cumulative: 1500 },
        { period: '2026-09-02', total: 300, cumulative: 1800 },
        { period: '2026-09-03', total: 0, cumulative: 1800 },
      ]);
    });

    it('is empty without data', () => {
      expect(totalSeries([])).toEqual([]);
    });
  });

  describe('labels', () => {
    it('names a month and numbers a day', () => {
      expect(periodTick('2026-09')).toBe('sept.');
      expect(periodTick('2026-09-04')).toBe('4');
      expect(periodLabel('2026-09')).toBe('sept. 2026');
      expect(periodLabel('2026-09-04')).toBe('4 sept. 2026');
    });
  });
});
