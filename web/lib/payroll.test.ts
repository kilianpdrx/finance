import { describe, it, expect } from 'vitest';
import type { Payslip } from '@/lib/api/hooks';
import {
  BLOCKS, addMonths, baseSalary, blockOf, blockTotal, bounds, breakdown, byEmployer, change, convertPayslips, employerColors, employerSeries,
  formatRate, gaps,
  heldBack, heldElsewhere, inRange, linesNet, monthName, monthsBetween, ofMonth, rates, retainedBalance, series, share, situationFor, spanLabel,
  timeline, totals, unclassified, within, yearBefore, yearRates,
} from './payroll';

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
      { year: '2025', months: 1, contributions: 1193, tax: 1056, other: -33, taken: 2216, unpaid: 2216, held: 0 },
      // January's −30 and February's +30 cancel out; tax is not (10,56 + 15,84) / 2 = 13,20.
      { year: '2026', months: 2, contributions: 795, tax: 1408, other: 0, taken: 2203, unpaid: 2203, held: 0 },
    ]);
    const r = yearRates(slips2)[1];
    expect((r.contributions ?? 0) + (r.tax ?? 0) + (r.other ?? 0)).toBe(r.taken);
    expect(yearRates([])).toEqual([]);
  });

  it('states what is gone for good beside what is not paid yet', () => {
    const rueckbehalt = (kind: 'retained' | 'released') =>
      ({ id: 7, label: 'Total Rückbehalt', kind, amount_cents: 31000, base_cents: null, rate_bp: null, employer_cents: null });
    // 310 held back lowers the payout, not « prélevé »: it is still the employee's.
    const held = slip('2026-03', { net_paid_cents: 700575 - 31000, lines: [...slip('2026-03').lines, rueckbehalt('retained')] });
    const plain = rates(series([slip('2026-03')], 'month')[0]);
    const r = rates(series([held], 'month')[0]);
    expect([r.contributions, r.tax, r.other, r.taken]).toEqual([plain.contributions, plain.tax, plain.other, plain.taken]);
    // « Non versé » counts it: 2 304,25 of 9 000 are not in the payout, 310 of them held back.
    expect([plain.unpaid, plain.held, r.unpaid, r.held]).toEqual([2216, 0, 2560, 344]);
    expect(r.taken! + r.held!).toBe(r.unpaid);
    // Paid out at last: more paid than earned net, « dont retenu » negative.
    const paidOut = rates(series([slip('2026-04', { net_paid_cents: 700575 + 31000, lines: [...slip('2026-04').lines, rueckbehalt('released')] })], 'month')[0]);
    expect([paidOut.taken, paidOut.unpaid, paidOut.held]).toEqual([2216, 1871, -345]);
    expect(rates({ gross: 0, contributions: 0, tax: 0, net: 0, held: 0 })).toEqual(
      { contributions: null, tax: null, other: null, taken: null, unpaid: null, held: null });
  });

  it('adds up months and years, two employers in one month included', () => {
    const slips = [slip('2025-12'), slip('2026-01'), slip('2026-02'), slip('2026-02', { id: 99, employer_id: 2 })];
    expect(series(slips, 'year').map((p) => [p.period, p.count, p.net])).toEqual([['2025', 1, 700575], ['2026', 3, 3 * 700575]]);
    expect(series(slips, 'month').map((p) => [p.period, p.count])).toEqual([['2025-12', 1], ['2026-01', 1], ['2026-02', 2]]);
    expect(totals(slips)).toEqual({
      gross: 4 * 900000, contributions: 4 * 107385, tax: 4 * 95040, net: 4 * 700575, held: 0, count: 4, months: 3,
    });
  });

  it("finds an employer's base salary and since when, never across employers", () => {
    const raise = (period: string, employer_id = 1, cents = 880000) => slip(period, {
      employer_id, lines: slip(period).lines.map((l) => (l.label === 'Monatslohn' ? { ...l, amount_cents: cents } : l)),
    });
    const slips = [slip('2025-12'), slip('2026-01'), raise('2026-02'), raise('2026-03'), raise('2026-01', 2, 500000)];
    expect(baseSalary(slips, 1)).toEqual({ cents: 880000, since: '2026-02' });
    expect(baseSalary(slips, 1, '2026-01')).toEqual({ cents: 850000, since: '2025-12' });
    expect(baseSalary(slips, 2)).toEqual({ cents: 500000, since: '2026-01' });
    expect(baseSalary(slips, 3)).toBeNull();
    // A bonus is not a raise; 0,5 % is rounding.
    const bonus = slip('2026-04', { lines: slip('2026-04').lines.map((l) => (l.label === 'Bonus' ? { ...l, amount_cents: 300000 } : l)) });
    expect(baseSalary([slip('2026-03'), bonus], 1)).toEqual({ cents: 850000, since: '2026-03' });
    expect(baseSalary([slip('2026-03'), raise('2026-04', 1, 852000)], 1)).toEqual({ cents: 852000, since: '2026-03' });
  });

  it('states rates and finds the missing months', () => {
    expect(share(95040, 900000)).toBe(1056);
    expect(share(1, 0)).toBeNull();
    expect(formatRate(1056)).toMatch(/^10,56\s%$/);
    expect(gaps([slip('2026-01'), slip('2026-04'), slip('2026-05', { employer_id: 2 }), slip('2026-11'), slip('2027-01')])).toEqual([
      { employer_id: 1, period: '2026-02' }, { employer_id: 1, period: '2026-03' },
      ...['05', '06', '07', '08', '09', '10', '12'].map((m) => ({ employer_id: 1, period: `2026-${m}` })),
    ]);
    expect(monthName('2026-09')).toBe('septembre 2026');
  });

  it('shows a year, the last twelve months, everything, or months of your choosing', () => {
    const slips = ['2025-08', '2025-09', '2025-10', '2026-09'].map((p) => slip(p));
    expect(inRange(slips, { kind: 'year', year: 2025 }).length).toBe(3);
    expect(inRange(slips, { kind: '12m' }).map((p) => p.period)).toEqual(['2025-10', '2026-09']);
    expect(inRange(slips, { kind: 'all' }).length).toBe(4);
    expect(inRange(slips, { kind: 'custom', from: '2025-10', to: '2025-09' }).map((p) => p.period)).toEqual(['2025-09', '2025-10']);
    expect(bounds(slips, { kind: 'year', year: 2026 })).toEqual({ from: '2026-01', to: '2026-12' });
    expect(bounds(slips, { kind: '12m' })).toEqual({ from: '2025-10', to: '2026-09' });
    expect(bounds([], { kind: '12m' })).toBeNull();
    expect(within(slips, null)).toEqual([]);
    expect([addMonths('2026-11', 3), addMonths('2026-01', -1), addMonths('2026-01', -13)]).toEqual(['2027-02', '2025-12', '2024-12']);
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect([spanLabel({ from: '2026-01', to: '2026-09' }), spanLabel({ from: '2025-03', to: '2026-02' }), spanLabel({ from: '2026-09', to: '2026-09' })])
      .toEqual(['janvier – septembre 2026', 'mars 2025 – février 2026', 'septembre 2026']);
  });

  it('compares a period with the same months a year earlier', () => {
    const slips = ['2025-01', '2025-02', '2025-03', '2025-11', '2026-01', '2026-02', '2026-03'].map((p) => slip(p));
    const year = bounds(slips, { kind: 'year', year: 2026 })!;
    const before = yearBefore(year, within(slips, year));
    expect(before).toEqual({ from: '2025-01', to: '2025-03' });                    // not November's
    expect(totals(within(slips, before)).months).toBe(3);
    expect(yearBefore(bounds(slips, { kind: '12m' })!, slips)).toEqual({ from: '2024-04', to: '2025-03' });
    expect(yearBefore(year, [])).toBeNull();
    expect(yearBefore({ from: '2025-04', to: '2026-03' }, slips)).toEqual({ from: '2024-04', to: '2025-03' });
    expect(yearBefore({ from: '2025-03', to: '2026-03' }, slips)).toBeNull();          // 13 months: no year before
    expect([change(1100, 1000), change(900, 1000), change(1, 0)]).toEqual([100, -100, null]);
  });
});

describe('employers', () => {
  const at = (employer_id: number, ...periods: string[]) => periods.map((p, i) => slip(p, { id: employer_id * 1000 + i, employer_id }));
  const months = (from: string, to: string) => monthsBetween(from, to);

  it('lays the employers out in sequence, one at the same time as another below it', () => {
    const slips = [
      ...at(1, ...months('2025-01', '2025-06'), ...months('2025-09', '2025-12')),     // a gap: two stretches
      ...at(2, ...months('2025-06', '2025-08')),                                     // overlaps June
      ...at(3, ...months('2026-01', '2026-03')),
    ];
    const { segments, lanes } = timeline(slips);
    expect(lanes).toBe(2);
    expect(segments.map((s) => [s.employerId, s.from, s.to, s.months, s.lane])).toEqual([
      [1, '2025-01', '2025-06', 6, 0], [2, '2025-06', '2025-08', 3, 1], [1, '2025-09', '2025-12', 4, 0], [3, '2026-01', '2026-03', 3, 0],
    ]);
    // Starting together, the longer one keeps the band.
    const together = timeline([...at(5, '2027-01', '2027-02'), ...at(4, ...months('2027-01', '2027-12'))]);
    expect(together.segments.map((s) => [s.employerId, s.lane])).toEqual([[4, 0], [5, 1]]);
    expect(timeline([])).toEqual({ segments: [], lanes: 0 });
  });

  it('gives each employer a colour of its own, by when it first paid', () => {
    const slips = [...at(1, '2025-01'), ...at(2, '2024-05')];
    const colors = employerColors(slips, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect([colors.get(2), colors.get(1), colors.get(3)]).toEqual(['var(--series-1)', 'var(--series-2)', 'var(--series-3)']);
    // A filter showing only employer 1 does not repaint it: colours are given over every payslip.
    const many = employerColors(slips, Array.from({ length: 10 }, (_, i) => ({ id: i + 1 })));
    expect([many.get(9), many.get(10)]).toEqual(['var(--muted-foreground)', 'var(--muted-foreground)']);   // never cycled
  });

  it("states each employer's figures and stacks them month by month", () => {
    const missing = { status: 'missing' as const, transaction_id: null, date: null, amount_cents: null, description: null, difference_cents: 0 };
    const slips = [...at(1, '2026-01'), slip('2026-02', { id: 5, deposit: missing }), ...at(2, '2026-02')];
    const [one, two] = byEmployer(slips);
    expect([one.employerId, one.from, one.to, one.totals.count, one.deposits]).toEqual([1, '2026-01', '2026-02', 2, { found: 1, total: 2 }]);
    expect([two.employerId, two.totals.net, two.rates.taken]).toEqual([2, 700575, 2216]);
    expect(employerSeries(slips, 'gross', ['2026-01', '2026-02', '2026-03'])).toEqual([
      { period: '2026-01', e1: 900000 }, { period: '2026-02', e1: 900000, e2: 900000 }, { period: '2026-03' },
    ]);
    expect(employerSeries(slips, 'net', ['2026-02'])[0].e2).toBe(700575);
  });
});

describe('several currencies', () => {
  const paris = (period: string) => slip(period, { id: 900 + Number(period.slice(5)), employer_id: 2, currency: 'EUR' });
  const fx = [
    { currency: 'CHF', period: '2026-08', rate: 1.05 },
    { currency: 'CHF', period: '2026-09', rate: null },
  ];

  it('converts each payslip at its own month, every amount and line, and keeps the rest as is', () => {
    const { payslips, missing } = convertPayslips([paris('2026-08'), slip('2026-08'), slip('2026-09')], 'EUR', fx);
    expect(missing.map((p) => p.period)).toEqual(['2026-09']);       // no rate: left out, never added unconverted
    const [eur, chf] = payslips;
    expect(eur).toBe(payslips[0]);
    expect(eur.gross_cents).toBe(900000);                               // already in EUR: untouched
    expect(chf).toMatchObject({ id: 202608, currency: 'EUR', gross_cents: 945000, net_paid_cents: 735604, withholding_cents: 99792,
      employee_contributions_cents: 112754, taxable_cents: 945000, employer_contributions_cents: null, withholding_rate_bp: 1056 });
    expect(chf.lines.map((l) => l.amount_cents)).toEqual([892500, 52500, 50085, 43297, 99792, 15750]);
    expect(chf.lines[2]).toMatchObject({ base_cents: 945000, rate_bp: 530 });
    expect(chf.deposit).toMatchObject({ amount_cents: 735604, difference_cents: 0, status: 'paid' });
    // Totals add both employers up in one currency; rates are the same either way.
    expect(totals(payslips).gross).toBe(1845000);
    expect(rates(totals([chf])).tax).toBe(rates(totals([slip('2026-08')])).tax);
  });

  it('never changes the payslip it was given', () => {
    const original = slip('2026-08');
    convertPayslips([original], 'EUR', fx);
    expect(original.currency).toBe('CHF');
    expect(original.lines[0].amount_cents).toBe(850000);
  });
});
