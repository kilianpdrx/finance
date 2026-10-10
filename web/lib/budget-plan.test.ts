import { describe, it, expect } from 'vitest';
import {
  amountToCents, barFill, centsToAmount, draftsFromPlan, draftsToPayload, eligibleCategories, fitsKind, isMinimum,
  monthPace, moveCategory, planTotals, standing, type DraftEnvelope,
} from './budget-plan';

describe('budget-plan.ts', () => {
  describe('monthPace', () => {
    it('places today inside the current month', () => {
      expect(monthPace('2026-10', new Date(2026, 9, 9))).toBeCloseTo(9 / 31);
      expect(monthPace('2026-02', new Date(2026, 1, 28))).toBe(1);      // last day of a 28-day month
    });

    it('reads a past month as over and a future one as not started', () => {
      expect(monthPace('2026-09', new Date(2026, 9, 9))).toBe(1);
      expect(monthPace('2025-12', new Date(2026, 0, 3))).toBe(1);
      expect(monthPace('2026-11', new Date(2026, 9, 9))).toBe(0);
    });
  });

  describe('standing', () => {
    it('a ceiling is over once exceeded, whatever the day', () => {
      expect(standing('expense', 400_00, 400_00, false)).toBe('ok');
      expect(standing('expense', 400_01, 400_00, false)).toBe('over');
      expect(standing('unplanned', 900_00, 150_00, true)).toBe('over');
    });

    it('a minimum is short only when the month is over', () => {
      expect(isMinimum('income') && isMinimum('goal')).toBe(true);
      expect(isMinimum('expense') || isMinimum('unplanned')).toBe(false);
      expect(standing('income', 2450_00, 2900_00, false)).toBe('ok');     // still time
      expect(standing('income', 2450_00, 2900_00, true)).toBe('short');
      expect(standing('goal', 300_00, 300_00, false)).toBe('reached');
    });

    it('says nothing without a target', () => {
      expect(standing('expense', 500_00, null, true)).toBe('none');
      expect(standing('income', 0, undefined, true)).toBe('none');
    });
  });

  it('fills a bar up to its end, never past it', () => {
    expect(barFill(286_00, 400_00)).toBeCloseTo(71.5);
    expect(barFill(900_00, 400_00)).toBe(100);
    expect(barFill(0, 0)).toBe(0);
    expect(barFill(50_00, 0)).toBe(100);       // spending with nothing planned
  });

  it('adds up what the plan assigns, and what it leaves', () => {
    const totals = planTotals([
      { kind: 'income', target_cents: 2900_00 },
      { kind: 'expense', target_cents: 1150_00 },
      { kind: 'expense', target_cents: 800_00 },
      { kind: 'goal', target_cents: 300_00 },
      { kind: 'unplanned', target_cents: 150_00 },
    ]);
    expect(totals).toEqual({ income: 2900_00, ceilings: 1950_00, goals: 300_00, provision: 150_00, unassigned: 500_00 });
    expect(planTotals([{ kind: 'expense', target_cents: 100_00 }]).unassigned).toBe(-100_00);   // spends more than it earns
  });

  describe('the editor', () => {
    const drafts: DraftEnvelope[] = [
      { key: 'e1', id: 1, name: 'Courses', kind: 'expense', amount: '400', categoryIds: [10, 11] },
      { key: 'n2', id: null, name: ' Sorties ', kind: 'expense', amount: '152,50', categoryIds: [] },
      { key: 'e3', id: 3, name: 'Imprévus', kind: 'unplanned', amount: '', categoryIds: [99] },
    ];

    it('moves a category to one envelope, out of wherever it was', () => {
      const moved = moveCategory(drafts, 11, 'n2');
      expect(moved.map((d) => d.categoryIds)).toEqual([[10], [11], [99]]);
      expect(moveCategory(moved, 11, 'n2')[1].categoryIds).toEqual([11]);       // no duplicate
      expect(moveCategory(drafts, 10, null).map((d) => d.categoryIds)).toEqual([[11], [], [99]]);
      expect(drafts[0].categoryIds).toEqual([10, 11]);                          // the original is untouched
    });

    it('turns the working copy into what the API saves', () => {
      expect(draftsToPayload(drafts)).toEqual([
        { id: 1, name: 'Courses', kind: 'expense', amount_cents: 400_00, category_ids: [10, 11] },
        { id: null, name: 'Sorties', kind: 'expense', amount_cents: 152_50, category_ids: [] },
        { id: 3, name: 'Imprévus', kind: 'unplanned', amount_cents: 0, category_ids: [] },   // the provision holds no category
      ]);
    });

    it('reads amounts as typed and writes them back plainly', () => {
      expect([amountToCents('1 850'), amountToCents('12,5'), amountToCents('abc'), amountToCents('-4')]).toEqual([1850_00, 12_50, 0, 0]);
      expect([centsToAmount(400_00), centsToAmount(152_50), centsToAmount(0)]).toEqual(['400', '152,50', '0']);
    });

    it('starts from a plan or a proposal', () => {
      const out = draftsFromPlan({ envelopes: [
        { id: 7, name: 'Courses', kind: 'expense', amount_cents: 410_00, category_ids: [10] },
        { id: null, name: 'Imprévus', kind: 'unplanned', amount_cents: 300_00, category_ids: [] },
      ] as never });
      expect(out.map((d) => [d.key, d.id, d.amount])).toEqual([['e7', 7, '410'], ['p1', null, '300']]);
    });

    it('offers leaves of this account, on the envelope own side', () => {
      const categories = [
        { id: 1, name: 'Maison', parent_id: null, account_id: null, archived: false, is_income: false },
        { id: 2, name: 'Bricolage', parent_id: 1, account_id: null, archived: false, is_income: false },
        { id: 3, name: 'Ancienne', parent_id: null, account_id: null, archived: true, is_income: false },
        { id: 4, name: 'Ailleurs', parent_id: null, account_id: 8, archived: false, is_income: false },
        { id: 5, name: 'Ici', parent_id: null, account_id: 7, archived: false, is_income: false },
        { id: 6, name: 'Salaire', parent_id: null, account_id: null, archived: false, is_income: true },
      ];
      const offered = eligibleCategories(categories, 7);
      expect(offered.map((c) => c.id)).toEqual([2, 5, 6]);            // not the parent, the archived one, another account's
      expect(offered.filter((c) => fitsKind(c, 'income')).map((c) => c.id)).toEqual([6]);
      expect(offered.filter((c) => fitsKind(c, 'goal')).map((c) => c.id)).toEqual([2, 5]);
      expect(offered.some((c) => fitsKind(c, 'unplanned'))).toBe(false);
    });
  });
});
