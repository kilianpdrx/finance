import { describe, it, expect } from 'vitest';
import {
  amountToCents, barFill, centsToAmount, clearDetail, draftAmountCents, draftsFromPlan, draftsToPayload, eligibleCategories,
  fillWithTypical, fitsKind, isDetailed, isMinimum, monthPace, moveCategory, planTotals, setCategoryAmount, standing,
  type DraftEnvelope,
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
      { kind: 'income', amount_cents: 2900_00 },
      { kind: 'expense', amount_cents: 1150_00 },
      { kind: 'expense', amount_cents: 800_00 },
      { kind: 'goal', amount_cents: 300_00 },
      { kind: 'unplanned', amount_cents: 150_00 },
    ]);
    expect(totals).toEqual({ income: 2900_00, ceilings: 1950_00, goals: 300_00, provision: 150_00, unassigned: 500_00 });
    expect(planTotals([{ kind: 'expense', amount_cents: 100_00 }]).unassigned).toBe(-100_00);   // spends more than it earns
  });

  describe('the editor', () => {
    const drafts: DraftEnvelope[] = [
      { key: 'e1', id: 1, name: 'Courses', kind: 'expense', amount: '400', categoryIds: [10, 11], categoryAmounts: {} },
      { key: 'n2', id: null, name: ' Sorties ', kind: 'expense', amount: '152,50', categoryIds: [], categoryAmounts: {} },
      { key: 'e3', id: 3, name: 'Imprévus', kind: 'unplanned', amount: '', categoryIds: [99], categoryAmounts: {} },
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
        { id: 7, name: 'Courses', kind: 'expense', amount_cents: 410_00, category_ids: [10, 11],
          categories: [{ category_id: 10, amount_cents: 260_00 }, { category_id: 11, amount_cents: null }] },
        { id: null, name: 'Imprévus', kind: 'unplanned', amount_cents: 300_00, category_ids: [] },
      ] as never });
      expect(out.map((d) => [d.key, d.id, d.amount])).toEqual([['e7', 7, '410'], ['p1', null, '300']]);
      expect(out.map((d) => d.categoryAmounts)).toEqual([{ 10: '260' }, {}]);      // a category without an amount has no line
    });

    describe('the detail, category by category', () => {
      const daily: DraftEnvelope = { key: 'e1', id: 1, name: 'Quotidien', kind: 'expense', amount: '400', categoryIds: [10, 11, 12], categoryAmounts: {} };
      const lined: DraftEnvelope = { ...daily, categoryAmounts: { 10: '260', 11: '', 12: '0' } };

      it('an envelope is the sum of its lines as soon as it has one', () => {
        expect([isDetailed(daily), draftAmountCents(daily)]).toEqual([false, 400_00]);
        expect([isDetailed(lined), draftAmountCents(lined)]).toEqual([true, 260_00]);        // "400" is no longer read
        expect(isDetailed({ ...daily, categoryAmounts: { 10: '  ' } })).toBe(false);         // an emptied cell is no line
        expect(isDetailed({ ...daily, categoryAmounts: { 12: '0' } })).toBe(true);           // a typed 0 is one
        expect(isDetailed({ ...daily, categoryAmounts: { 99: '50' } })).toBe(false);         // a line of a category that left
        expect(isDetailed({ ...lined, kind: 'unplanned' })).toBe(false);
      });

      it('types an amount on the line of whichever envelope holds the category', () => {
        const other: DraftEnvelope = { key: 'e2', id: 2, name: 'Logement', kind: 'expense', amount: '800', categoryIds: [20], categoryAmounts: {} };
        const next = setCategoryAmount([daily, other], 11, '95,50');
        expect(next.map((d) => d.categoryAmounts)).toEqual([{ 11: '95,50' }, {}]);
        expect(draftAmountCents(next[0])).toBe(95_50);
        expect(daily.categoryAmounts).toEqual({});                                           // the original is untouched
      });

      it('saves the lines, and only the lines someone typed', () => {
        expect(draftsToPayload([lined, daily])).toEqual([
          { id: 1, name: 'Quotidien', kind: 'expense', amount_cents: 260_00, category_ids: [10, 11, 12], category_amounts: { 10: 260_00, 12: 0 } },
          { id: 1, name: 'Quotidien', kind: 'expense', amount_cents: 400_00, category_ids: [10, 11, 12] },
        ]);
      });

      it('a line follows its category only into an envelope planned line by line', () => {
        const plain: DraftEnvelope = { key: 'e2', id: 2, name: 'Loisirs', kind: 'expense', amount: '150', categoryIds: [20], categoryAmounts: {} };
        const detailed: DraftEnvelope = { ...plain, key: 'e3', id: 3, categoryAmounts: { 20: '90' } };

        const intoPlain = moveCategory([lined, plain], 10, 'e2');
        expect(intoPlain[0].categoryAmounts).toEqual({ 11: '', 12: '0' });
        expect([intoPlain[1].categoryIds, intoPlain[1].categoryAmounts, draftAmountCents(intoPlain[1])]).toEqual([[20, 10], {}, 150_00]);

        const intoDetailed = moveCategory([lined, detailed], 10, 'e3');
        expect([intoDetailed[1].categoryAmounts, draftAmountCents(intoDetailed[1])]).toEqual([{ 20: '90', 10: '260' }, 350_00]);
        expect(draftAmountCents(intoDetailed[0])).toBe(0);                                   // still detailed: its "0" line remains

        expect(moveCategory([lined], 10, null)[0].categoryAmounts).toEqual({ 11: '', 12: '0' });   // out of every envelope
      });

      it('starts a detail from the typical months, and goes back to one figure', () => {
        const typical = new Map<number, number | null>([[10, 263_40], [11, 41_60], [12, null]]);
        const filled = fillWithTypical(daily, (id) => typical.get(id));
        expect(filled.categoryAmounts).toEqual({ 10: '263', 11: '42', 12: '0' });
        expect(draftAmountCents(filled)).toBe(305_00);

        const back = clearDetail(filled);
        expect([back.categoryAmounts, back.amount, isDetailed(back)]).toEqual([{}, '305', false]);   // keeps what the lines added up to
      });
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
