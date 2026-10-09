import { describe, it, expect } from 'vitest';
import { trendGranularity, totalSeries, periodTick, periodLabel, movingAverage, trendWindow, trendCurveName } from './trends';

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

  describe('movingAverage', () => {
    it('averages each point with the periods before it', () => {
      expect(movingAverage([300, 600, 900, 1200], 3)).toEqual([300, 450, 600, 900]);
    });

    it('uses what exists at the start of the series', () => {
      expect(movingAverage([1000], 3)).toEqual([1000]);
      expect(movingAverage([1000, 0], 7)).toEqual([1000, 500]);
    });

    it('never looks ahead: a later spike leaves earlier points untouched', () => {
      const calm = movingAverage([100, 100, 100, 100], 3);
      const spike = movingAverage([100, 100, 100, 90000], 3);
      expect(spike.slice(0, 3)).toEqual(calm.slice(0, 3));
    });

    it('counts empty periods as zero and rounds to whole cents', () => {
      expect(movingAverage([0, 0, 900], 3)).toEqual([0, 0, 300]);
      expect(movingAverage([100, 101], 2)).toEqual([100, 101]);   // 100.5 → 101
      expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
      expect(movingAverage([], 3)).toEqual([]);
    });
  });

  describe('trend curve', () => {
    it('averages a quarter by month and a week by day', () => {
      expect(trendWindow('month')).toBe(3);
      expect(trendWindow('day')).toBe(7);
      expect(trendCurveName('month')).toBe('Moyenne sur 3 mois');
      expect(trendCurveName('day')).toBe('Moyenne sur 7 jours');
    });
  });
});
