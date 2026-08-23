"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HoldingsImportPreviewResponse } from "@/lib/api/hooks";

const TYPE_LABELS: Record<string, string> = {
  stock: "Action",
  etf: "ETF",
  crypto: "Crypto",
  bond: "Obligation",
  fund: "Fonds",
};

const DUPLICATE_LABELS: Record<string, string> = {
  skip: "Ignorer",
  replace: "Remplacer",
  merge: "Fusionner",
};

export type DuplicateAction = "skip" | "replace" | "merge";

/** Shared review table for the holdings CSV import (used by the in-page dialog
 *  and the /importer flow). Presentational only. */
export function HoldingsImportReview({
  preview,
  actions,
  onActionChange,
}: {
  preview: HoldingsImportPreviewResponse;
  actions: Record<string, DuplicateAction>;
  onActionChange: (ticker: string, v: DuplicateAction) => void;
}) {
  const newCount = preview.holdings.filter((h) => !h.is_duplicate).length;
  const dupCount = preview.duplicates;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">{preview.format.toUpperCase()}</span>
        <span className="text-sm text-muted-foreground">
          {newCount} nouvelle{newCount !== 1 ? "s" : ""}{dupCount > 0 && `, ${dupCount} doublon${dupCount !== 1 ? "s" : ""}`}
        </span>
      </div>

      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 text-left font-medium">Ticker</th>
              <th className="py-2 text-left font-medium">Nom</th>
              <th className="py-2 text-left font-medium">Type</th>
              <th className="py-2 text-right font-medium">Qté</th>
              <th className="py-2 text-right font-medium">Coût</th>
              <th className="py-2 text-right font-medium">Devise</th>
              <th className="py-2 text-center font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {preview.holdings.map((h) => (
              <tr key={h.ticker} className={cn("border-b border-border/60", h.is_duplicate && "bg-amber-500/5")}>
                <td className="py-2 font-mono text-xs font-semibold">{h.ticker}</td>
                <td className="max-w-[160px] truncate py-2">{h.name}</td>
                <td className="py-2 text-xs text-muted-foreground">{TYPE_LABELS[h.asset_type] ?? h.asset_type}</td>
                <td className="nums py-2 text-right">{h.quantity % 1 === 0 ? h.quantity : h.quantity.toFixed(4)}</td>
                <td className="nums py-2 text-right">{formatCents(h.cost_basis_cents, h.currency)}</td>
                <td className="py-2 text-right text-xs">{h.currency}</td>
                <td className="py-2 text-center">
                  {h.is_duplicate ? (
                    <Select value={actions[h.ticker] ?? "skip"} onValueChange={(v) => onActionChange(h.ticker, v as DuplicateAction)}>
                      <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">{DUPLICATE_LABELS.skip}</SelectItem>
                        <SelectItem value="replace">{DUPLICATE_LABELS.replace}</SelectItem>
                        <SelectItem value="merge">{DUPLICATE_LABELS.merge}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-positive">Nouvelle</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
