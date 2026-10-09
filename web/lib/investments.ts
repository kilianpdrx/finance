import type { InvestmentAccount } from "@/lib/api/hooks";

/** Figures of the Investissements → Synthèse tab, derived from what the page
 *  already loads. Amounts are integer cents in the account's currency. */

export interface Gain {
  cents: number | null;
  pct: number | null;
}

/** What an account has earned, stated the way its own tab states it: against
 *  the purchase cost when it holds priced positions, against its first
 *  statement — later contributions taken out — when it is followed by
 *  statements. Null when neither is known yet. */
export function accountGain(acc: InvestmentAccount): Gain {
  return acc.has_holdings
    ? { cents: acc.holdings_gain_cents, pct: acc.holdings_gain_pct }
    : { cents: acc.perf_from_start_cents, pct: acc.perf_pct_from_start };
}

/** Share of a total, in percent with one decimal. 0 when there is no total. */
export function sharePct(valueCents: number, totalCents: number): number {
  return totalCents > 0 ? Math.round((valueCents / totalCents) * 1000) / 10 : 0;
}

export interface PortfolioTotals {
  valueCents: number;
  gainCents: number;
  /** Gain over the capital it was made on. Null when no account has a gain yet. */
  gainPct: number | null;
  dividendsCents: number;
  /** Dividend yield weighted by the value of each account. */
  avgYield: number | null;
}

export function portfolioTotals(accounts: InvestmentAccount[]): PortfolioTotals {
  let value = 0, gain = 0, capital = 0, dividends = 0, yieldNum = 0;
  for (const acc of accounts) {
    const v = acc.current_value_cents ?? 0;
    value += v;
    dividends += acc.est_annual_div_cents ?? 0;
    yieldNum += (acc.avg_dividend_yield ?? 0) * v;
    const g = accountGain(acc).cents;
    // Value minus gain is what went in: the purchase cost of the positions, or
    // the first statement plus what was contributed since.
    if (g != null) { gain += g; capital += v - g; }
  }
  return {
    valueCents: value,
    gainCents: gain,
    gainPct: capital > 0 ? Math.round((gain / capital) * 1000) / 10 : null,
    dividendsCents: dividends,
    avgYield: value > 0 && yieldNum > 0 ? Math.round((yieldNum / value) * 100) / 100 : null,
  };
}

export interface MonthChange {
  cents: number;
  pct: number | null;
  from: string;   // YYYY-MM
  to: string;     // YYYY-MM
  /** Accounts the comparison could be made on. */
  accounts: number;
}

/** A point of the evolution chart: the total, and one value per account name. */
export type SeriesPoint = { month: string; total_cents: number } & Record<string, unknown>;

/** Change between the last two months of the evolution chart, over the
 *  accounts that have a value in BOTH months. Comparing the two totals instead
 *  would count an account that enters the series — a first statement, a first
 *  position — as a gain of its whole value.
 *
 *  It is a change in VALUE: money added during the month is part of it — the
 *  series knows values, not what was paid in. Null when nothing is comparable. */
export function monthChange(series: SeriesPoint[]): MonthChange | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  let cents = 0, base = 0, accounts = 0;
  for (const [key, before] of Object.entries(prev)) {
    const after = last[key];
    if (key === "month" || key === "total_cents" || typeof before !== "number" || typeof after !== "number") continue;
    cents += after - before;
    base += before;
    accounts += 1;
  }
  if (accounts === 0) return null;
  return {
    cents,
    pct: base > 0 ? Math.round((cents / base) * 1000) / 10 : null,
    from: prev.month,
    to: last.month,
    accounts,
  };
}

export interface Position {
  id: number;
  ticker: string;
  name: string;
  assetType: string;
  accountName: string;
  accountColor: string;
  currency: string;
  valueCents: number;
  gainPct: number | null;
}

/** The largest lines across every account, cash included: where the money is. */
export function topPositions(accounts: InvestmentAccount[], limit = 8): Position[] {
  return accounts
    .flatMap((acc) => (acc.holdings ?? []).map((h) => ({
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      assetType: h.asset_type,
      accountName: acc.name,
      accountColor: acc.color,
      currency: acc.currency,
      valueCents: h.value_in_account_ccy_cents ?? h.current_value_cents ?? 0,
      gainPct: h.gain_pct,
    })))
    .filter((p) => p.valueCents > 0)
    .sort((a, b) => b.valueCents - a.valueCents)
    .slice(0, limit);
}
