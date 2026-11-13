/**
 * « Projection des revenus sur 12 mois », one series per holding.
 *
 * The API projects each holding's payments month by month
 * (`/investments/dividend-calendar`, items carry ticker and name). The chart
 * stacks them per holding — the same ticker in two accounts is one holding —
 * largest first. With more holdings than colours, the last colour becomes
 * « Autres (n) »: colours come from a fixed-order palette and are never cycled,
 * so two series never share one.
 *
 * Series keys are synthetic (`h0`, `h1`…, `other`): Recharts reads a dataKey
 * with a dot as a path, and tickers like « MC.PA » or « BRK.B » have one.
 */

export interface ProjectionItem {
  ticker: string;
  name: string | null;
  amount_cents: number;
}

export interface ProjectionMonth {
  month: string;
  items: ProjectionItem[];
}

export interface ProjectionSeries {
  key: string;
  label: string;
  /** The holdings behind the series: one, or those folded into « Autres ». */
  tickers: string[];
  color: string;
  /** Over the whole projection. */
  total_cents: number;
  other: boolean;
}

export type ProjectionRow = { month: string } & Record<string, number | string>;

export interface ProjectionByHolding {
  series: ProjectionSeries[];
  rows: ProjectionRow[];
}

export const OTHERS_LABEL = "Autres";

export function holdingKey(item: Pick<ProjectionItem, "ticker" | "name">): string {
  return (item.ticker || item.name || "?").trim().toUpperCase();
}

export function projectionByHolding(monthly: ProjectionMonth[], palette: readonly string[]): ProjectionByHolding {
  const holdings = new Map<string, { ticker: string; label: string; total: number }>();
  for (const m of monthly) {
    for (const it of m.items) {
      if (!(it.amount_cents > 0)) continue;
      const key = holdingKey(it);
      const h = holdings.get(key) ?? { ticker: it.ticker || key, label: "", total: 0 };
      h.total += it.amount_cents;
      if (!h.label) h.label = it.name?.trim() || "";
      holdings.set(key, h);
    }
  }

  const ranked = [...holdings.entries()]
    .map(([key, h]) => ({ key, ticker: h.ticker, label: h.label || h.ticker, total: h.total }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "fr"));

  const slots = palette.length;
  const fits = ranked.length <= slots;
  const shown = fits ? ranked : ranked.slice(0, Math.max(slots - 1, 0));
  const folded = fits ? [] : ranked.slice(shown.length);

  const series: ProjectionSeries[] = shown.map((h, i) => ({
    key: `h${i}`,
    label: h.label,
    tickers: [h.ticker],
    color: palette[i],
    total_cents: h.total,
    other: false,
  }));
  if (folded.length > 0) {
    series.push({
      key: "other",
      label: `${OTHERS_LABEL} (${folded.length})`,
      tickers: folded.map((h) => h.ticker),
      color: palette[slots - 1],
      total_cents: folded.reduce((s, h) => s + h.total, 0),
      other: true,
    });
  }

  const seriesOf = new Map<string, string>();
  shown.forEach((h, i) => seriesOf.set(h.key, `h${i}`));
  for (const h of folded) seriesOf.set(h.key, "other");

  const rows = monthly.map((m) => {
    const row: ProjectionRow = { month: m.month };
    for (const s of series) row[s.key] = 0;
    for (const it of m.items) {
      if (!(it.amount_cents > 0)) continue;
      const k = seriesOf.get(holdingKey(it));
      if (k) row[k] = (row[k] as number) + it.amount_cents;
    }
    return row;
  });

  return { series, rows };
}
