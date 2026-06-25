"use client";

import React, { useState } from "react";
import { X, ChevronDown, Pencil, AlertTriangle } from "lucide-react";
import { useHoldingMutations, type HoldingOut } from "@/lib/api/hooks";
import { HoldingPriceChart } from "./holding-price-chart";
import { EditHoldingDialog } from "./edit-holding-dialog";
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

const TYPE_LABELS: Record<string, string> = {
  stock: "Action",
  etf: "ETF",
  crypto: "Crypto",
  bond: "Obligation",
  fund: "Fonds",
};

export function HoldingsTable({ holdings, currency }: { holdings: HoldingOut[]; currency: string }) {
  const { remove } = useHoldingMutations();
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<HoldingOut | null>(null);

  if (holdings.length === 0) return null;

  // Allocation must use account-currency values (an account can mix USD + EUR holdings).
  const accVal = (h: HoldingOut) => h.value_in_account_ccy_cents ?? h.current_value_cents ?? 0;
  const totalValue = holdings.reduce((s, h) => s + accVal(h), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="w-6" />
            <th className="py-2 text-left font-medium">Ticker</th>
            <th className="py-2 text-left font-medium">Nom</th>
            <th className="py-2 text-left font-medium">Type</th>
            <th className="py-2 text-right font-medium">Qté</th>
            <th className="py-2 text-right font-medium">Prix</th>
            <th className="py-2 text-right font-medium">Valeur</th>
            <th className="py-2 text-right font-medium">Coût</th>
            <th className="py-2 text-right font-medium">+/-</th>
            <th className="py-2 text-right font-medium">%</th>
            <th className="py-2 text-right font-medium">Alloc.</th>
            <th className="py-2 text-right font-medium">Yield</th>
            <th className="py-2 text-right font-medium">YOC</th>
            <th className="py-2 text-right font-medium">Rev. Est.</th>
            <th className="py-2 text-right font-medium">Freq.</th>
            <th className="py-2 text-right font-medium">Payout</th>
            <th className="py-2 text-right font-medium">DGR 5a</th>
            <th className="py-2 text-right font-medium">Ex-Date</th>
            <th className="w-14" />
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const alloc = totalValue > 0 && accVal(h) ? Math.round((accVal(h) / totalValue) * 1000) / 10 : null;
            const isExpanded = expandedTicker === h.ticker;
            return (
              <React.Fragment key={h.id}>
                <tr
                  onClick={() => setExpandedTicker(isExpanded ? null : h.ticker)}
                  className={cn("cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/30", isExpanded && "bg-muted/20")}
                >
                  <td className="py-2 pl-1">
                    <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                  </td>
                  <td className="py-2 font-mono text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {h.ticker.toUpperCase()}
                      {h.price_status !== "ok" && (
                        <span title="Cours indisponible — vérifiez le ticker / ISIN" className="inline-flex">
                          <AlertTriangle className="size-3 text-warning" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="max-w-[140px] truncate py-2">{h.name}</td>
                  <td className="py-2 text-xs text-muted-foreground">{TYPE_LABELS[h.asset_type] ?? h.asset_type}</td>
                  <td className="nums py-2 text-right">{h.quantity % 1 === 0 ? h.quantity : h.quantity.toFixed(4)}</td>
                  <td className="nums py-2 text-right text-muted-foreground">
                    {h.current_price_cents != null ? formatCents(h.current_price_cents, h.price_currency ?? h.currency, { decimals: 2 }) : "—"}
                  </td>
                  <td className="nums blurable py-2 text-right font-medium">
                    {h.current_value_cents != null ? formatCents(h.current_value_cents, h.price_currency ?? h.currency, { decimals: 2 }) : "—"}
                  </td>
                  <td className="nums py-2 text-right text-muted-foreground">{formatCents(h.cost_basis_cents, h.currency, { decimals: 2 })}</td>
                  <td className={cn("nums py-2 text-right font-medium", h.gain_cents != null && h.gain_cents >= 0 ? "text-positive" : "text-negative")}>
                    {h.gain_cents != null ? formatCents(h.gain_cents, h.price_currency ?? h.currency, { sign: true, decimals: 2 }) : "—"}
                  </td>
                  <td className={cn("nums py-2 text-right text-xs font-semibold", h.gain_pct != null && h.gain_pct >= 0 ? "text-positive" : "text-negative")}>
                    {h.gain_pct != null ? `${h.gain_pct >= 0 ? "+" : ""}${h.gain_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="nums py-2 text-right text-xs text-muted-foreground">{alloc != null ? `${alloc}%` : "—"}</td>
                  <td className="nums py-2 text-right text-xs text-muted-foreground">
                    {h.dividend_yield != null ? (
                      <span className="inline-flex items-center gap-1">
                        <span className={cn("inline-block size-1.5 rounded-full", dividendSafetyColor(h))} />
                        {h.dividend_yield.toFixed(2)}%
                      </span>
                    ) : "—"}
                  </td>
                  <td className="nums py-2 text-right text-xs text-muted-foreground">{h.yield_on_cost != null ? `${h.yield_on_cost.toFixed(2)}%` : "—"}</td>
                  <td className="nums py-2 text-right text-xs text-muted-foreground">
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
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setEditing(h)} className="text-muted-foreground transition-colors hover:text-foreground" title="Modifier le ticker / ISIN">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => remove.mutate(h.id)} className="text-muted-foreground transition-colors hover:text-negative" title="Supprimer">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={19} className="border-b border-border/60 px-4 pb-3">
                      <HoldingPriceChart ticker={h.ticker} currency={h.price_currency ?? h.currency} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <EditHoldingDialog open={editing != null} onOpenChange={(v) => !v && setEditing(null)} holding={editing} />
    </div>
  );
}
