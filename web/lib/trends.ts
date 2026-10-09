import { formatMonthLabel } from "./format";

/** How the trend charts bucket time: `YYYY-MM` periods, or `YYYY-MM-DD` ones. */
export type TrendGranularity = "month" | "day";

/** Up to about two months, one bar per month says nothing about WHEN the money
 *  went — the range is shown day by day instead. */
const DAILY_MAX_DAYS = 62;

export function trendGranularity(dateFrom?: string | null, dateTo?: string | null): TrendGranularity {
  if (!dateFrom || !dateTo) return "month";   // open-ended range ("Tout l'historique")
  const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 + 1;
  return days > 0 && days <= DAILY_MAX_DAYS ? "day" : "month";
}

export interface TotalPoint {
  period: string;
  /** Sum of every category for that period. */
  total: number;
  /** Running sum since the first period. */
  cumulative: number;
}

/** Collapse per-category series into one total per period, with the running sum
 *  — the "when in the month do I spend" curve. */
export function totalSeries(trends: { series: { period: string; amount_cents: number }[] }[]): TotalPoint[] {
  const totals = new Map<string, number>();
  for (const t of trends) for (const p of t.series) totals.set(p.period, (totals.get(p.period) ?? 0) + p.amount_cents);
  let running = 0;
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, total]) => ({ period, total, cumulative: (running += total) }));
}

/** Axis tick: the month name ("sept.") or the day of the month ("14"). */
export function periodTick(period: string): string {
  return period.length > 7 ? String(Number(period.slice(8, 10))) : formatMonthLabel(period);
}

/** Tooltip title: "sept. 2026" or "14 sept. 2026". */
export function periodLabel(period: string): string {
  const month = formatMonthLabel(period.slice(0, 7), { withYear: true });
  return period.length > 7 ? `${Number(period.slice(8, 10))} ${month}` : month;
}

/** Periods the trend curve averages over: a quarter by month, a week by day. */
export function trendWindow(granularity: TrendGranularity): number {
  return granularity === "day" ? 7 : 3;
}

/** "Moyenne sur 3 mois" / "Moyenne sur 7 jours" — the curve's name. */
export function trendCurveName(granularity: TrendGranularity): string {
  return granularity === "day" ? "Moyenne sur 7 jours" : "Moyenne sur 3 mois";
}

/** Below this many periods a moving average only repeats the bars. */
export const TREND_MIN_POINTS = 3;

/** Trailing moving average: each point is the mean of itself and the
 *  `window - 1` periods before it (fewer at the start, where they don't exist).
 *  Trailing, not centred: the last point must not depend on a future that has
 *  not happened. Rounded to whole cents. */
export function movingAverage(values: number[], window: number): number[] {
  const size = Math.max(1, Math.floor(window));
  let sum = 0;
  return values.map((v, i) => {
    sum += v;
    if (i >= size) sum -= values[i - size];
    return Math.round(sum / Math.min(i + 1, size));
  });
}
