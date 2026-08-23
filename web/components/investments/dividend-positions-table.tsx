"use client";

import type { HoldingOut } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

const FREQ_LABELS: Record<string, string> = {
  monthly: "M",
  quarterly: "Q",
  "semi-annual": "SA",
  annual: "A",
};
function freqLabel(freq: string | null | undefined) {
  return freq ? FREQ_LABELS[freq] ?? freq : "—";
}
function dividendSafetyColor(h: { payout_ratio?: number | null; dividend_growth_rate?: number | null }) {
  const pr = h.payout_ratio;
  const gr = h.dividend_growth_rate;
  if (pr == null) return "bg-muted-foreground/40";
  if (pr > 80) return "bg-red-500";
  if (pr > 60 || (gr != null && gr < 0)) return "bg-yellow-500";
  return "bg-emerald-500";
}

/** A holding "pays a dividend" if Yahoo reports a yield or an estimated income. */
export function hasDividend(h: HoldingOut) {
  return (h.dividend_yield != null && h.dividend_yield > 0) || (h.est_annual_income_cents != null && h.est_annual_income_cents > 0);
}

/** Lists every dividend-paying position with the detail columns that used to
 *  clutter the live holdings table (yield, YOC, est. income, frequency, payout,
 *  growth, ex-date). Sorted by estimated annual income, highest first. */
export function DividendPositionsTable({ holdings, currency }: { holdings: HoldingOut[]; currency: string }) {
  const rows = holdings
    .filter(hasDividend)
    .sort((a, b) => (b.est_annual_income_cents ?? 0) - (a.est_annual_income_cents ?? 0));

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Aucune position versant de dividende.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-2 text-left font-medium">Ticker</th>
            <th className="py-2 text-left font-medium">Nom</th>
            <th className="py-2 text-right font-medium">Qté</th>
            <th className="py-2 text-right font-medium">Yield</th>
            <th className="py-2 text-right font-medium">YOC</th>
            <th className="py-2 text-right font-medium">Rev. Est.</th>
            <th className="py-2 text-right font-medium">Freq.</th>
            <th className="py-2 text-right font-medium">Payout</th>
            <th className="py-2 text-right font-medium">DGR 5a</th>
            <th className="py-2 text-right font-medium">Ex-Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id} className="border-b border-border/60">
              <td className="py-2 font-mono text-xs font-semibold">{h.ticker.toUpperCase()}</td>
              <td className="max-w-[180px] truncate py-2">{h.name}</td>
              <td className="nums py-2 text-right">{h.quantity % 1 === 0 ? h.quantity : h.quantity.toFixed(4)}</td>
              <td className="nums py-2 text-right text-xs text-muted-foreground">
                {h.dividend_yield != null ? (
                  <span className="inline-flex items-center gap-1">
                    <span className={cn("inline-block size-1.5 rounded-full", dividendSafetyColor(h))} />
                    {h.dividend_yield.toFixed(2)}%
                  </span>
                ) : "—"}
              </td>
              <td className="nums py-2 text-right text-xs text-muted-foreground">{h.yield_on_cost != null ? `${h.yield_on_cost.toFixed(2)}%` : "—"}</td>
              <td className="nums blurable py-2 text-right text-xs font-medium text-emerald-500">
                {h.est_annual_income_cents != null ? `${formatCents(h.est_annual_income_cents, h.currency, { decimals: 0 })}/an` : "—"}
              </td>
              <td className="nums py-2 text-right text-xs text-muted-foreground">{freqLabel(h.frequency)}</td>
              <td className="nums py-2 text-right text-xs text-muted-foreground">{h.payout_ratio != null ? `${h.payout_ratio.toFixed(0)}%` : "—"}</td>
              <td className={cn("nums py-2 text-right text-xs", h.dividend_growth_rate != null && h.dividend_growth_rate >= 0 ? "text-positive" : h.dividend_growth_rate != null ? "text-negative" : "text-muted-foreground")}>
                {h.dividend_growth_rate != null ? `${h.dividend_growth_rate >= 0 ? "+" : ""}${h.dividend_growth_rate.toFixed(1)}%` : "—"}
              </td>
              <td className="nums py-2 text-right text-xs text-muted-foreground">
                {h.ex_dividend_date ? new Date(h.ex_dividend_date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
