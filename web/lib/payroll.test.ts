import { describe, it, expect } from 'vitest';
import type { Payslip } from '@/lib/api/hooks';
import {
  BLOCKS, blockOf, blockTotal, breakdown, formatRate, gaps, heldBack, heldElsewhere, inRange, linesNet, monthName, ofMonth, raises, retainedBalance, series, share, situationFor,
  rates, unclassified, yearRates, yearToDate,
} from './payroll';
import { mergeLayout, parseLayout, toLayout } from './payroll-widgets';

// An invented Zurich salary: 9 000 gross, 1 073,85 of contributions, 950,40 of tax.
function slip(period: string, over: Partial<Payslip> = {}): Payslip {
  return {
    id: Number(period.replace('-', '')), employer_id: 1, period, pay_date: null, currency: 'CHF',
    gross_cents: 900000, employee_contributions_cents: 107385, employer_contributions_cents: null,
    taxable_cents: 900000, withholding_cents: 95040, withholding_rate_bp: 1056, net_paid_cents: 700575,
    source: 'pdf', document_id: null, note: null,
    lines: [
      { id: 1, label: 'Monatslohn', kind: 'gross', amount_cents: 850000, base_cents: null, rate_bp: null, employer_cents: null },
      { id: 2, label: 'Bonus', kind: 'gross', amount_cents: 50000, base_cents: null, rate_bp: null, employer_cents: null },
      { id: 3, label: 'AHV/IV/EO', kind: 'social', amount_cents: 47700, base_cents: 900000, rate_bp: 530, employer_cents: null },
      { id: 4, label: 'BVG', kind: 'pension', amount_cents: 41235, base_cents: null, rate_bp: null, employer_cents: null },
      { id: 5, label: 'Quellensteuer A0N', kind: 'tax', amount_cents: 95040, base_cents: 900000, rate_bp: 1056, employer_cents: null },
      { id: 6, label: 'Spesen', kind: 'addition', amount_cents: 15000, base_cents: null, rate_bp: null, employer_cents: null },
    ],
    deposit: { status: 'paid', transaction_id: 1, date: null, amount_cents: 700575, description: null, difference_cents: 0 },
    ...over,
  } as Payslip;
}

describe('payroll.ts', () => {
  it('computes the net the lines give, as the backend does', () => {
    const lines = [
      { kind: 'gross' as const, amount_cents: 900000 }, { kind: 'social' as const, amount_cents: 66150 },
      { kind: 'pension' as const, amount_cents: 41235 }, { kind: 'tax' as const, amount_cents: 95040 },
      { kind: null, amount_cents: 12000 }, { kind: 'addition' as const, amount_cents: 15000 },
    ];
    expect(linesNet(lines)).toBe(712575);                       // the canteen line, unclassified, is not taken
    expect(unclassified(lines)).toBe(1);
    expect(linesNet([...lines.slice(0, 4), { kind: 'deduction', amount_cents: 12000 }, lines[5]])).toBe(700575);
    expect(linesNet([{ kind: 'gross', amount_cents: 100 }], 900000)).toBe(900000);   // a printed gross wins
    // Pay held back leaves the payout; paid out at last, it comes back.
    expect(linesNet([{ kind: 'gross', amount_cents: 900000 }, { kind: 'retained', amount_cents: 31000 }])).toBe(869000);
    expect(linesNet([{ kind: 'gross', amount_cents: 900000 }, { kind: 'released', amount_cents: 31000 }, { kind: 'info', amount_cents: 5 }])).toBe(931000);
  });

  it('elides « de » before a month starting with a vowel', () => {
    expect([ofMonth('2026-09'), ofMonth('2026-10'), ofMonth('2026-04'), ofMonth('2026-08')])
      .toEqual(['de septembre 2026', "d'octobre 2026", "d'avril 2026", "d'août 2026"]);
  });

  it('sorts every type into one block, each with its subtotal', () => {
    expect(BLOCKS.map((b) => b.id)).toEqual(['unclassified', 'gross', 'contributions', 'tax', 'other', 'retained', 'info']);
    expect([blockOf(null).id, blockOf('pension').id, blockOf('addition').id, blockOf('released').id]).toEqual(['unclassified', 'contributions', 'other', 'retained']);
    const lines = [
      { kind: 'social' as const, amount_cents: 47700 }, { kind: 'pension' as const, amount_cents: 41235 },
      { kind: 'deduction' as const, amount_cents: 12000 }, { kind: 'addition' as const, amount_cents: 15000 },
    ];
    expect(blockTotal(blockOf('social'), lines)).toBe(88935);
    expect(blockTotal(blockOf('deduction'), lines)).toBe(3000);          // signed: +150 − 120
  });

  it('finds the situation in force for a year', () => {
    const zurich = { id: 1, from_year: 2024, pack: 'ch_zh', params: {}, summary: '' };
    const france = { id: 2, from_year: 2027, pack: 'fr', params: {}, summary: '' };
    expect(situationFor([france, zurich], 2026)?.pack).toBe('ch_zh');
    expect(situationFor([france, zurich], 2028)?.pack).toBe('fr');
    expect(situationFor([france, zurich], 2020)?.pack).toBe('ch_zh');   // older than every situation: the first
    expect(situationFor([], 2026)).toBeNull();
  });

  it('reads one month as a cascade of blocks, even typed without lines', () => {
    expect(breakdown(slip('2026-09')).map((s) => [s.block.id, s.effect])).toEqual(
      [['contributions', -88935], ['tax', -95040], ['other', 15000]]);
    const typed = breakdown(slip('2026-09', { lines: [] }));
    expect(typed.map((s) => [s.block.id, s.effect])).toEqual([['contributions', -107385], ['tax', -95040]]);
  });

  it('adds up what an employer holds back until the end of the contract', () => {
    const held = (period: string, kind: 'retained' | 'released', cents: number, employer_id = 1) => slip(period, {
      employer_id, lines: [{ id: 9, label: 'Rückbehalt', kind, amount_cents: cents, base_cents: null, rate_bp: null, employer_cents: null }],
    });
    const slips = [held('2026-08', 'retained', 31000), held('2026-09', 'retained', 31000), held('2026-09', 'retained', 5000, 2),
      held('2026-10', 'released', 62000)];
    expect(retainedBalance(slips, 1, '2026-09')).toEqual({ cents: 62000, since: '2026-08' });
    expect(retainedBalance(slips, 1, '2026-10')).toEqual({ cents: 0, since: '2026-08' });
    expect(retainedBalance([slip('2026-09')], 1, '2026-09')).toBeNull();
    // Month by month, the months between included: the balance carries on.
    const [one, two] = heldBack([...slips, slip('2026-11')]);
    expect(one.months.map((m) => [m.period, m.retained, m.released, m.balance])).toEqual([
      ['2026-08', 31000, 0, 31000], ['2026-09', 31000, 0, 62000], ['2026-10', 0, 62000, 0], ['2026-11', 0, 0, 0]]);
    expect([one.retained, one.released, one.labels]).toEqual([62000, 62000, ['Rückbehalt']]);
    expect([two.employerId, two.balance, two.since]).toEqual([2, 5000, '2026-09']);
  });

  it('points out held-back pay saved as another type', () => {
    const line = { id: 9, label: 'Total Rückbehalt', amount_cents: 31000, base_cents: null, rate_bp: null, employer_cents: null };
    const old = slip('2026-09', { lines: [{ ...line, kind: 'deduction', vocab_kind: 'retained' }] });
    const fixed = slip('2026-10', { lines: [{ ...line, kind: 'retained', vocab_kind: 'retained' }] });
    expect(heldElsewhere([old, fixed]).map((e) => [e.label, e.kind, e.payslips.map((p) => p.period)]))
      .toEqual([['Total Rückbehalt', 'deduction', ['2026-09']]]);
    expect(heldElsewhere([slip('2026-09')])).toEqual([]);
  });

  it('gives each year its rate: its total over its total gross', () => {
    // 9 000 gross with 950,40 of tax, and a bonus month of 18 000 with 2 851,20 (15,84 %).
    const slips = [slip('2025-12'), slip('2026-01'), slip('2026-02', { gross_cents: 1800000, withholding_cents: 285120 })];
    // The bonus month pays 18 000 − 1 073,85 − 2 851,20 − 30 of other deductions = 14 044,95.
    const bonus = { gross_cents: 1800000, withholding_cents: 285120, net_paid_cents: 1404495 };
    const slips2 = [slips[0], slips[1], slip('2026-02', bonus)];
    expect(yearRates(slips2)).toEqual([
      // 9 000 − 1 073,85 − 950,40 = 6 975,75, and 7 005,75 paid: expenses outweigh deductions (−0,33 %).
      { year: '2025', months: 1, contributions: 1193, tax: 1056, other: -33, total: 2216 },
      // January's −30 and February's +30 cancel out; tax is not (10,56 + 15,84) / 2 = 13,20.
      { year: '2026', months: 2, contributions: 795, tax: 1408, other: 0, total: 2203 },
    ]);
    const r = yearRates(slips2)[1];
    expect((r.contributions ?? 0) + (r.tax ?? 0) + (r.other ?? 0)).toBe(r.total);
    expect(yearRates([])).toEqual([]);
    // 310 held back lowers the payout, not the total: it is still the employee's.
    const held = slip('2026-03', { net_paid_cents: 700575 - 31000, lines: [...slip('2026-03').lines,
      { id: 7, label: 'Total Rückbehalt', kind: 'retained', amount_cents: 31000, base_cents: null, rate_bp: null, employer_cents: null }] });
    expect(rates(series([held], 'month')[0])).toEqual(rates(series([slip('2026-03')], 'month')[0]));
  });

  it('adds up months and years, and marks a raise but not a bonus', () => {
    const slips = [slip('2025-12'), slip('2026-01'), slip('2026-02', {
      lines: slip('2026-02').lines.map((l) => (l.label === 'Monatslohn' ? { ...l, amount_cents: 880000 } : l)),
    })];
    expect(series(slips, 'year').map((p) => [p.period, p.months, p.net])).toEqual([['2025', 1, 700575], ['2026', 2, 1401150]]);
    expect(series(slips, 'month').map((p) => p.period)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect([...raises(slips)]).toEqual(['2026-02']);
    const bonusOnly = slip('2026-03', { lines: slip('2026-03').lines.map((l) => (l.label === 'Bonus' ? { ...l, amount_cents: 300000 } : l)) });
    expect(raises([slip('2026-02'), bonusOnly]).size).toBe(0);
  });

  it('compares the year so far with the same months last year', () => {
    const slips = ['2025-01', '2025-02', '2025-03', '2025-11', '2026-01', '2026-02', '2026-03'].map((p) => slip(p));
    const ytd = yearToDate(slips, 2026);
    expect([ytd.untilMonth, ytd.now.months, ytd.before.months]).toEqual(['03', 3, 3]);   // not November's
    expect(ytd.now.net).toBe(3 * 700575);
  });

  it('states rates and finds the missing months', () => {
    expect(share(95040, 900000)).toBe(1056);
    expect(share(1, 0)).toBeNull();
    expect(formatRate(1056)).toMatch(/^10,56\s%$/);
    expect(gaps([slip('2026-01'), slip('2026-04'), slip('2026-05', { employer_id: 2 })])).toEqual([
      { employer_id: 1, period: '2026-02' }, { employer_id: 1, period: '2026-03' },
    ]);
    expect(monthName('2026-09')).toBe('septembre 2026');
  });

  it('shows a year, the last twelve months, or everything', () => {
    const slips = ['2025-08', '2025-09', '2025-10', '2026-09'].map((p) => slip(p));
    expect(inRange(slips, { kind: 'year', year: 2025 }).length).toBe(3);
    expect(inRange(slips, { kind: '12m' }).map((p) => p.period)).toEqual(['2025-10', '2026-09']);
    expect(inRange(slips, { kind: 'all' }).length).toBe(4);
  });
});

describe('payroll-widgets.ts', () => {
  const defaults = ['month', 'evolution', 'ytd', 'rates', 'deposits', 'payslips'];

  it('keeps the saved order, and shows a widget the saved layout does not know', () => {
    const saved = { order: ['payslips', 'month', 'gone'], hidden: ['month'] };
    expect(mergeLayout(saved, defaults)).toEqual([
      { id: 'payslips', visible: true }, { id: 'month', visible: false },
      { id: 'evolution', visible: true }, { id: 'ytd', visible: true }, { id: 'rates', visible: true }, { id: 'deposits', visible: true },
    ]);
    expect(mergeLayout(null, defaults).every((w) => w.visible)).toBe(true);
    expect(toLayout(mergeLayout(saved, defaults))).toEqual({
      order: ['payslips', 'month', 'evolution', 'ytd', 'rates', 'deposits'], hidden: ['month'],
    });
  });

  it('puts a widget added later after the one it follows by default', () => {
    const board = { order: ['payslips', 'ytd', 'month', 'evolution', 'rates', 'deposits'], hidden: [] };
    expect(mergeLayout(board, ['month', 'retained', ...defaults.slice(1)]).map((w) => w.id))
      .toEqual(['payslips', 'ytd', 'month', 'retained', 'evolution', 'rates', 'deposits']);
    expect(mergeLayout({ order: ['payslips'], hidden: [] }, ['month', 'payslips']).map((w) => w.id)).toEqual(['month', 'payslips']);
  });

  it('reads a stored layout, or none', () => {
    expect(parseLayout('{"order":["ytd"],"hidden":[]}')).toEqual({ order: ['ytd'], hidden: [] });
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout(undefined)).toBeNull();
  });
});
