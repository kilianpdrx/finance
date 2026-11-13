import { describe, it, expect } from 'vitest';
import type { Payslip, PayslipRead } from '@/lib/api/hooks';
import {
  addLine, canSave, checkDraft, compare, comparisonNotes, draftFromRead, draftManual, draftStatus, draftToBody, employerForRead, forEmployer,
  labelKey, moveLine, moveLineTo, restoreLine, setKind, type Draft,
} from './payroll-review';

// What `POST /payroll/read` returns for the invented Zurich payslip of the backend tests.
const read: PayslipRead = {
  filename: 'lohn-09.pdf', sha256: 'x', error: null, duplicate_payslip_id: null, employer_id: null, pack: 'ch_zh',
  period: '2026-09', pay_date: '2026-09-25', totals: {},
  figures: { gross_cents: 900000, employee_contributions_cents: 107385, employer_contributions_cents: null,
    taxable_cents: 900000, withholding_cents: 95040, withholding_rate_bp: 1056, net_paid_cents: 700575 },
  checks: { unclassified: 1 },
  lines: [
    { label: 'AHV/IV/EO', key: 'ahv iv eo', kind: 'social', amount_cents: 47700, base_cents: 900000, rate_bp: 530, employer_cents: null, negative: true },
    { label: 'ALV', key: 'alv', kind: 'social', amount_cents: 9900, base_cents: 900000, rate_bp: 110, employer_cents: null, negative: true },
    { label: 'NBU', key: 'nbu', kind: 'social', amount_cents: 8550, base_cents: 900000, rate_bp: 95, employer_cents: null, negative: true },
    { label: 'BVG', key: 'bvg', kind: 'pension', amount_cents: 41235, base_cents: null, rate_bp: null, employer_cents: null, negative: true },
    { label: 'Kantinenabzug', key: 'kantinenabzug', kind: null, amount_cents: 12000, base_cents: null, rate_bp: null, employer_cents: null, negative: true },
    { label: 'Quellensteuer A0N', key: 'quellensteuer a n', kind: 'tax', amount_cents: 95040, base_cents: 900000, rate_bp: 1056, employer_cents: null, negative: true },
    { label: 'Monatslohn', key: 'monatslohn', kind: 'gross', amount_cents: 900000, base_cents: null, rate_bp: null, employer_cents: null, negative: false },
    { label: 'Spesen', key: 'spesen', kind: 'addition', amount_cents: 15000, base_cents: null, rate_bp: null, employer_cents: null, negative: false },
  ],
};
const file = new File(['%PDF-'], 'lohn-09.pdf', { type: 'application/pdf' });

const labels = (d: Draft) => d.lines.map((l) => l.label);
const uidOf = (d: Draft, label: string) => d.lines.find((l) => l.label === label)!.uid;

/** The same payslip, saved for employer 7: its lines in `order` (the others after), with some types changed. */
function saved(period: string, order: string[] = [], kinds: [string, string][] = []): Payslip {
  const types = new Map(kinds);
  const rank = (label: string) => (order.includes(label) ? order.indexOf(label) : order.length);
  return {
    id: Number(period.replace('-', '')), employer_id: 7, period, pay_date: `${period}-25`, currency: 'CHF',
    gross_cents: 900000, employee_contributions_cents: 107385, employer_contributions_cents: null, taxable_cents: 900000,
    withholding_cents: 95040, withholding_rate_bp: 1056, net_paid_cents: 700575, source: 'pdf', document_id: null, note: null,
    lines: [...read.lines].sort((a, b) => rank(a.label) - rank(b.label)).map((l, i) => ({
      id: i, label: l.label, kind: (types.get(l.label) ?? l.kind ?? 'deduction') as Payslip['lines'][number]['kind'],
      amount_cents: l.amount_cents, base_cents: l.base_cents, rate_bp: l.rate_bp, employer_cents: l.employer_cents,
    })),
    deposit: { status: 'no_account', transaction_id: null, date: null, amount_cents: null, description: null, difference_cents: 0 },
  } as Payslip;
}

describe('payroll-review.ts', () => {
  it('asks for a look while a line is « à classer », and is ready once classified', () => {
    const d = draftFromRead(read, file, 7);
    expect(checkDraft(d)).toEqual({ unclassified: 1, netGap: 12000, periodOk: true, employerOk: true });
    expect([draftStatus(d), canSave(d)]).toEqual(['check', false]);

    const classified = { ...d, lines: d.lines.map((l) => (l.kind ? l : { ...l, kind: 'deduction' as const })) };
    expect(checkDraft(classified).netGap).toBe(0);
    expect([draftStatus(classified), canSave(classified)]).toEqual(['ready', true]);

    const body = draftToBody(classified);
    expect(body).toMatchObject({ employer_id: 7, period: '2026-09', pay_date: '2026-09-25', gross_cents: 900000,
      employee_contributions_cents: 107385, withholding_cents: 95040, withholding_rate_bp: 1056, taxable_cents: 900000,
      net_paid_cents: 700575 });
    expect(body.lines.find((l) => l.label === 'Kantinenabzug')?.kind).toBe('deduction');
  });

  it("leaves a second employer's payslip to the user, and says when a month is already there", () => {
    const sept = saved('2026-09');
    // One employer, already paid in September: a September payslip printing no known name is not assumed to be its.
    expect(employerForRead(read, [{ id: 7 }], [sept], [])).toBeNull();
    expect(employerForRead({ ...read, period: '2026-10' }, [{ id: 7 }], [sept], [])).toBe(7);
    expect(employerForRead({ ...read, employer_id: 8 }, [{ id: 7 }, { id: 8 }], [sept], [])).toBe(8);   // its name is on it
    expect(employerForRead(read, [{ id: 7 }, { id: 8 }], [], [])).toBeNull();
    const first = draftFromRead(read, file, 7);
    expect(employerForRead(read, [{ id: 7 }], [], [first])).toBeNull();                                   // earlier in the import

    // Saved for that employer and month: a look, and « remplacer » ticked before saving.
    const classified = { ...first, lines: first.lines.map((l) => (l.kind ? l : { ...l, kind: 'deduction' as const })) };
    const c = compare(classified, [sept]);
    expect(c.clash).toBe('saved');
    expect([draftStatus(classified, c), canSave(classified, c), canSave({ ...classified, replace: true }, c)]).toEqual(['check', false, true]);
    // Another employer the same month: welcome.
    const other = { ...classified, employerId: 8 };
    expect(compare(other, [sept]).clash).toBeNull();
    expect(canSave(other, compare(other, [sept]))).toBe(true);
    // Twice in one import: the second waits for its employer.
    const second = { ...classified, uid: 'second' };
    expect(compare(second, [], [classified, second]).clash).toBe('draft');
    expect(compare(classified, [], [classified, second]).clash).toBeNull();
  });

  it('re-applies an employer\'s classifications when the employer changes', () => {
    const d = draftFromRead(read, file, null);
    expect(draftStatus(d)).toBe('check');                                  // no employer yet
    const next = forEmployer(d, [{ employer_id: 7, label_key: 'kantinenabzug', kind: 'deduction' },
      { employer_id: 8, label_key: 'kantinenabzug', kind: 'info' }], [], 7);
    expect(next.lines.find((l) => l.key === 'kantinenabzug')?.kind).toBe('deduction');
    expect(next.employerId).toBe(7);
  });

  it('keeps the lines block by block, and saves them in the order shown', () => {
    const d = draftFromRead(read, file, 7);
    // À classer first, then gross, contributions, tax, others — each in PDF order.
    expect(labels(d)).toEqual(['Kantinenabzug', 'Monatslohn', 'AHV/IV/EO', 'ALV', 'NBU', 'BVG', 'Quellensteuer A0N', 'Spesen']);
    // Classified, the canteen joins « autres » before Spesen: it was read before it.
    const classified = setKind(d, uidOf(d, 'Kantinenabzug'), 'deduction');
    expect(labels(classified)).toEqual(['Monatslohn', 'AHV/IV/EO', 'ALV', 'NBU', 'BVG', 'Quellensteuer A0N', 'Kantinenabzug', 'Spesen']);
    // Up and down stay inside the block.
    expect(labels(moveLine(classified, uidOf(classified, 'AHV/IV/EO'), -1))).toEqual(labels(classified));
    const moved = moveLine(classified, uidOf(classified, 'BVG'), -1);
    expect(labels(moved).slice(1, 5)).toEqual(['AHV/IV/EO', 'ALV', 'BVG', 'NBU']);
    expect(labels(moveLineTo(moved, uidOf(moved, 'BVG'), uidOf(moved, 'AHV/IV/EO'))).slice(1, 5)).toEqual(['BVG', 'AHV/IV/EO', 'ALV', 'NBU']);
    expect(moveLineTo(moved, uidOf(moved, 'BVG'), uidOf(moved, 'Spesen'))).toEqual(moved);       // another block: no
    expect(draftToBody(moved).lines.map((l) => l.label).slice(1, 5)).toEqual(['AHV/IV/EO', 'ALV', 'BVG', 'NBU']);
    // A blank line lands in « à classer », which comes first.
    expect(addLine(moved).lines[0].label).toBe('');
  });

  it('follows the employer\'s last payslip: its types, then its order', () => {
    const september = saved('2026-09', ['NBU', 'BVG', 'AHV/IV/EO', 'ALV'], [['Kantinenabzug', 'deduction']]);
    const october = forEmployer(draftFromRead({ ...read, period: '2026-10', lines: [...read.lines,
      { label: 'Bonus', key: 'bonus', kind: 'gross', amount_cents: 50000, base_cents: null, rate_bp: null, employer_cents: null, negative: false }] },
    file, null), [], [september], 7);
    expect(october.lines.find((l) => l.key === 'kantinenabzug')?.kind).toBe('deduction');   // last time's type
    expect(labels(october)).toEqual(['Monatslohn', 'Bonus', 'NBU', 'BVG', 'AHV/IV/EO', 'ALV', 'Quellensteuer A0N', 'Kantinenabzug', 'Spesen']);
  });

  it('starts a typed payslip from the employer\'s last one', () => {
    const d = forEmployer(draftManual(null, '2026-10'), [], [saved('2026-09')], 7);
    expect([d.filledFrom, d.gross, d.net, d.lines.length]).toEqual(['2026-09', '9000', '7005,75', 8]);
    expect(forEmployer(draftManual(null, '2026-10'), [], [], 7).lines).toEqual([]);          // nothing to start from
  });

  it('compares a payslip with the one before: lines, rates, months', () => {
    const september = saved('2026-09');
    const lines = read.lines.filter((l) => l.label !== 'NBU').map((l) => (l.label === 'AHV/IV/EO' ? { ...l, rate_bp: 535, amount_cents: 48150 } : l));
    const november = forEmployer(draftFromRead({ ...read, period: '2026-11', pay_date: '2026-09-20', lines: [...lines,
      { label: 'Total Rückbehalt kumulierte Lohnarten', key: 'total ruckbehalt kumulierte lohnarten', kind: 'retained', amount_cents: 31000,
        base_cents: null, rate_bp: null, employer_cents: null, negative: true }] }, file, 7), [], [september], 7);
    const c = compare(november, [september]);
    expect(c.ref?.period).toBe('2026-09');
    expect(c.previous.get(uidOf(november, 'AHV/IV/EO'))).toEqual({ amount_cents: 47700, rate_bp: 530 });
    expect([...c.fresh].map((u) => november.lines.find((l) => l.uid === u)?.label)).toEqual(['Total Rückbehalt kumulierte Lohnarten']);
    expect(c.missing.map((l) => l.label)).toEqual(['NBU']);
    expect([c.gapMonths, c.payDateBack]).toEqual([['2026-10'], true]);
    expect(comparisonNotes(c).map((n) => n.tone)).toEqual(['warn', 'warn', 'warn']);
    expect(draftStatus({ ...november, lines: november.lines.map((l) => ({ ...l, kind: l.kind ?? 'deduction' })) }, c)).toBe('check');
    // October in the same import fills the gap; NBU typed back is no longer missing.
    const october = { ...draftFromRead({ ...read, period: '2026-10' }, file, 7), uid: 'oct' } as Draft;
    expect(compare(november, [september], [october, november])).toMatchObject({ gapMonths: [], ref: { period: '2026-10', saved: false } });
    expect(compare(restoreLine(november, c.missing[0]), [september]).missing).toEqual([]);
    // The very first payslip of an employer.
    expect(comparisonNotes(compare(draftFromRead(read, file, 7), []))[0].text).toMatch(/Première fiche/);
  });

  it('takes the gross from its lines, the printed one being a check', () => {
    // A gross figure left at 0 no longer counts once a line is gross.
    const d = { ...draftFromRead({ ...read, totals: { gross_total: 0, contributions_total: 107385 } }, file, 7), gross: '0' };
    expect([d.printedGross, d.printedContributions]).toEqual([null, 107385]);   // a printed 0 is a misread, not a check
    expect(draftToBody(d).gross_cents).toBe(900000);
    const classified = { ...d, lines: d.lines.map((l) => ({ ...l, kind: l.kind ?? 'deduction' as const })) };
    expect([checkDraft(classified).netGap, canSave(classified)]).toEqual([0, true]);
    expect(draftFromRead({ ...read, totals: { gross_total: 900000 } }, file, 7).printedGross).toBe(900000);
    // Without any gross line, the gross is typed.
    const typed = { ...draftManual(7, '2026-10'), gross: '', net: '100' };
    expect(canSave(typed)).toBe(false);
  });

  it('types a payslip without lines, and refuses a missing month', () => {
    const d = { ...draftManual(7, '2026-10'), gross: '9 000', net: '7005,75', contributions: '1073,85', withholding: '950,40', withholdingRate: '10,56' };
    expect(draftToBody(d)).toMatchObject({ gross_cents: 900000, employee_contributions_cents: 107385,
      withholding_cents: 95040, withholding_rate_bp: 1056, net_paid_cents: 700575, lines: [] });
    expect(canSave(d)).toBe(true);
    expect(canSave({ ...d, period: '2026-13' })).toBe(false);
  });

  it('never offers to save a file already imported or unreadable', () => {
    expect(draftStatus(draftFromRead({ ...read, duplicate_payslip_id: 3 }, file, 7))).toBe('duplicate');
    expect(draftStatus(draftFromRead({ ...read, error: 'Ce fichier n\'est pas un PDF.', lines: [] }, file, 7))).toBe('error');
  });

  it('keys a label as the backend does', () => {
    expect(labelKey('Impôt à la source')).toBe('impot a la source');
    expect(labelKey('13. Monatslohn')).toBe('monatslohn');
  });
});
