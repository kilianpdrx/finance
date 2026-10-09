import { describe, it, expect } from 'vitest';
import { accountGain, monthChange, portfolioTotals, sharePct, topPositions } from './investments';
import type { HoldingOut, InvestmentAccount } from '@/lib/api/hooks';

function account(over: Partial<InvestmentAccount>): InvestmentAccount {
  return {
    id: 1, name: 'Compte', bank_name: 'Banque', currency: 'EUR', color: '#000',
    current_value_cents: 0, first_value_cents: null, total_contributions_cents: 0, money_added_cents: 0,
    pct_from_start: null, pct_from_last_month: null, change_from_start_cents: null, change_from_last_month_cents: null,
    perf_pct_from_start: null, perf_pct_from_last_month: null, perf_from_start_cents: null, perf_from_last_month_cents: null,
    monthly: [], has_holdings: false, holdings: [], holdings_value_cents: null, holdings_cost_basis_cents: null,
    holdings_gain_cents: null, holdings_gain_pct: null, allocation_by_type: null, est_annual_div_cents: null, avg_dividend_yield: null,
    ...over,
  };
}
const holding = (over: Partial<HoldingOut>) => ({
  id: 1, ticker: 'AI.PA', name: 'Air Liquide', asset_type: 'stock',
  value_in_account_ccy_cents: 0, current_value_cents: 0, gain_pct: null, ...over,
}) as HoldingOut;

// A broker account worth 12 000 bought for 10 000, and a life-insurance
// contract worth 5 500 that started at 5 000 with nothing added since.
const LIVE = account({
  id: 1, name: 'PEA', has_holdings: true, current_value_cents: 1_200_000,
  holdings_gain_cents: 200_000, holdings_gain_pct: 20, est_annual_div_cents: 30_000, avg_dividend_yield: 2.5,
  // A statement-based figure must not leak into an account priced by its positions.
  perf_from_start_cents: 999, perf_pct_from_start: 99,
});
const LONG = account({
  id: 2, name: 'Assurance-vie', current_value_cents: 550_000,
  perf_from_start_cents: 50_000, perf_pct_from_start: 10,
});

describe('investments.ts', () => {
  it('states an account gain the way its own tab does', () => {
    expect(accountGain(LIVE)).toEqual({ cents: 200_000, pct: 20 });
    expect(accountGain(LONG)).toEqual({ cents: 50_000, pct: 10 });
    expect(accountGain(account({}))).toEqual({ cents: null, pct: null });
  });

  it('totals the portfolio and relates the gain to the capital put in', () => {
    const t = portfolioTotals([LIVE, LONG]);
    expect(t.valueCents).toBe(1_750_000);
    expect(t.gainCents).toBe(250_000);
    expect(t.gainPct).toBe(16.7);            // 2 500 on 15 000 put in
    expect(t.dividendsCents).toBe(30_000);
    expect(t.avgYield).toBe(1.71);           // 2.5 % on 12 000 of 17 500
  });

  it('leaves an account without a known gain out of the percentage, not out of the value', () => {
    const t = portfolioTotals([LIVE, account({ id: 3, current_value_cents: 800_000 })]);
    expect(t.valueCents).toBe(2_000_000);
    expect(t.gainCents).toBe(200_000);
    expect(t.gainPct).toBe(20);
    expect(portfolioTotals([]).gainPct).toBeNull();
    expect(portfolioTotals([]).avgYield).toBeNull();
  });

  it('reads a loss as a loss', () => {
    const t = portfolioTotals([account({ has_holdings: true, current_value_cents: 900_000, holdings_gain_cents: -100_000 })]);
    expect(t.gainCents).toBe(-100_000);
    expect(t.gainPct).toBe(-10);
  });

  it('computes a share of the total', () => {
    expect(sharePct(550_000, 1_750_000)).toBe(31.4);
    expect(sharePct(100, 0)).toBe(0);
  });

  it('compares the last two months of the series, account by account', () => {
    expect(monthChange([
      { month: '2026-08', total_cents: 1_000_000, PEA: 1_000_000 },
      { month: '2026-09', total_cents: 1_600_000, PEA: 1_100_000, PER: 500_000 },
      { month: '2026-10', total_cents: 1_520_000, PEA: 1_040_000, PER: 480_000 },
    ])).toEqual({ cents: -80_000, pct: -5, from: '2026-09', to: '2026-10', accounts: 2 });
  });

  it('does not count an account entering the series as a gain', () => {
    // The PER gets its first statement in October: 6 000 that were not "earned".
    const change = monthChange([
      { month: '2026-09', total_cents: 1_000_000, PEA: 1_000_000 },
      { month: '2026-10', total_cents: 1_650_000, PEA: 1_050_000, PER: 600_000 },
    ]);
    expect(change).toEqual({ cents: 50_000, pct: 5, from: '2026-09', to: '2026-10', accounts: 1 });
  });

  it('says nothing when no account is in both months', () => {
    expect(monthChange([{ month: '2026-10', total_cents: 1, PEA: 1 }])).toBeNull();
    expect(monthChange([])).toBeNull();
    expect(monthChange([{ month: '2026-09', total_cents: 5, PEA: 5 }, { month: '2026-10', total_cents: 7, PER: 7 }])).toBeNull();
    expect(monthChange([{ month: '2026-09', total_cents: 0, PEA: 0 }, { month: '2026-10', total_cents: 500, PEA: 500 }])?.pct).toBeNull();
  });

  it('lists the largest positions across accounts, cash included', () => {
    const a = account({ id: 1, name: 'PEA', color: '#111', holdings: [
      holding({ id: 1, ticker: 'CW8.PA', value_in_account_ccy_cents: 700_000, gain_pct: 12 }),
      holding({ id: 2, ticker: 'CASH.EUR', asset_type: 'cash', value_in_account_ccy_cents: 300_000 }),
      holding({ id: 3, ticker: 'VIDE', value_in_account_ccy_cents: 0 }),
    ] });
    const b = account({ id: 2, name: 'CTO', holdings: [
      holding({ id: 4, ticker: 'AI.PA', value_in_account_ccy_cents: null, current_value_cents: 500_000 }),
    ] });
    const top = topPositions([a, b], 2);
    expect(top.map((p) => p.ticker)).toEqual(['CW8.PA', 'AI.PA']);
    expect(top[0]).toMatchObject({ accountName: 'PEA', accountColor: '#111', valueCents: 700_000, gainPct: 12 });
    expect(topPositions([a, b]).map((p) => p.ticker)).toEqual(['CW8.PA', 'AI.PA', 'CASH.EUR']);   // nothing worth 0
  });
});
