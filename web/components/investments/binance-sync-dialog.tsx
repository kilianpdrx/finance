"use client";

import { useEffect } from "react";
import { AlertTriangle, DownloadCloud, FileCheck, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBinanceSync, useBinanceSyncPreview, type BinanceLine, type BinanceSyncPreview } from "@/lib/api/hooks";
import { formatCents, formatUnitPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<BinanceLine["status"], { label: string; className: string }> = {
  new: { label: "nouvelle", className: "bg-positive/10 text-positive" },
  updated: { label: "mise à jour", className: "bg-brand/10 text-brand" },
  unchanged: { label: "inchangée", className: "bg-muted text-muted-foreground" },
  removed: { label: "retirée", className: "bg-negative/10 text-negative" },
};

const qty = (q: number) => q.toLocaleString("fr-FR", { maximumFractionDigits: 8 });

/** What the preview says beyond the table: nothing Binance holds is left out
 *  without being named. */
function Notes({ preview }: { preview: BinanceSyncPreview }) {
  const review = preview.lines.filter((l) => l.review_cost).map((l) => l.asset);
  const notes: string[] = [];
  if (review.length) notes.push(`Quantité en hausse pour ${review.join(", ")} : si vous avez acheté, mettez à jour le PRU.`);
  if (preview.small_count) {
    notes.push(`${preview.small_count} solde${preview.small_count > 1 ? "s" : ""} de moins de 1 € non repris (${formatCents(preview.small_cents, "EUR", { decimals: 2 })} en tout).`);
  }
  if (preview.unpriced.length) notes.push(`Sans cours en euros sur Binance, non repris : ${preview.unpriced.join(", ")}.`);
  for (const w of preview.unread_wallets) {
    notes.push(`Portefeuille « ${w.name} » non lu (environ ${formatCents(w.value_cents, "EUR")}) : la synchronisation lit Spot, Funding et Earn.`);
  }
  if (!notes.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
      {notes.map((n) => <li key={n}>{n}</li>)}
    </ul>
  );
}

export function BinanceSyncDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const preview = useBinanceSyncPreview();
  const sync = useBinanceSync();

  // Read Binance when the dialog opens; nothing is written before Confirmer.
  useEffect(() => {
    if (!open) return;
    preview.reset();
    sync.reset();
    preview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const data = preview.data;
  const result = sync.data;
  const changes = data?.lines.filter((l) => l.status !== "unchanged").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadCloud className="size-4" /> Synchroniser depuis Binance
          </DialogTitle>
          <DialogDescription>
            Les quantités viennent de Binance ; les prix de revient que vous avez saisis sont gardés.
          </DialogDescription>
        </DialogHeader>

        {preview.isPending && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Lecture des soldes Binance…</p>
          </div>
        )}

        {(preview.isError || sync.isError) && (
          <div className="flex flex-col items-center gap-4 py-10">
            <AlertTriangle className="size-10 text-warning" />
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {(preview.error ?? sync.error)?.message ?? "Échec de la synchronisation Binance"}
            </p>
            <Button onClick={() => onOpenChange(false)}>Fermer</Button>
          </div>
        )}

        {data && !result && !sync.isError && (
          <div className="space-y-4">
            {data.lines.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Aucun solde à reprendre sur ce compte Binance.</p>
            ) : (
              <div className="max-h-[50vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 text-left font-medium">Crypto</th>
                      <th className="py-2 text-right font-medium">Quantité</th>
                      <th className="py-2 text-right font-medium">Cours</th>
                      <th className="py-2 text-right font-medium">Valeur</th>
                      <th className="py-2 pl-3 text-left font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l) => (
                      <tr key={l.asset} className={cn("border-b border-border/60", l.status === "unchanged" && "text-muted-foreground")}>
                        <td className="py-2">
                          <span className="font-mono text-xs font-semibold">{l.asset}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{l.name}</span>
                        </td>
                        <td className="nums py-2 text-right">
                          {l.previous_quantity != null && l.status !== "unchanged" && (
                            <span className="text-muted-foreground">{qty(l.previous_quantity)} → </span>
                          )}
                          {qty(l.quantity)}
                        </td>
                        <td className="nums py-2 text-right text-muted-foreground">
                          {l.is_cash ? "—" : l.price_cents != null ? formatUnitPrice(l.price_cents, "EUR") : "—"}
                        </td>
                        <td className={cn("nums blurable py-2 text-right font-medium",
                          l.status === "removed" && "font-normal text-muted-foreground line-through")}>
                          {l.value_cents != null ? formatCents(l.value_cents, "EUR", { decimals: 2 }) : "—"}
                        </td>
                        <td className="py-2 pl-3">
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS[l.status].className)}>
                            {STATUS[l.status].label}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="nums blurable text-right text-sm">
              Total : <span className="font-semibold">{formatCents(data.total_cents, "EUR", { decimals: 2 })}</span>
            </p>
            <Notes preview={data} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button onClick={() => sync.mutate()} disabled={sync.isPending || data.lines.length === 0}>
                {sync.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                {changes ? "Confirmer la synchronisation" : "Actualiser les cours"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {result && (
          <div className="flex flex-col items-center gap-4 py-6">
            <FileCheck className="size-12 text-positive" />
            <p className="text-center text-sm">
              {result.created} nouvelle{result.created > 1 ? "s" : ""}, {result.updated} mise{result.updated > 1 ? "s" : ""} à jour
              {result.removed > 0 && `, ${result.removed} retirée${result.removed > 1 ? "s" : ""}`}.
            </p>
            {result.created > 0 && (
              <p className="max-w-md text-center text-xs text-muted-foreground">
                Binance ne donne pas les prix d&apos;achat : indiquez le PRU de chaque position (crayon) pour voir son gain.
              </p>
            )}
            <Button onClick={() => onOpenChange(false)}>Fermer</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
