"use client";

import { useState, useCallback } from "react";
import { Upload, FileCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  holdingsImportPreview,
  holdingsImportConfirm,
  type HoldingsImportPreviewResponse,
  type HoldingImportItem,
  type HoldingsImportConfirmResponse,
  type ParsedHoldingPreview,
} from "@/lib/api/hooks";

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

type Step = "drop" | "review" | "done";

export function ImportHoldingsDialog({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: number;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("drop");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<HoldingsImportPreviewResponse | null>(null);
  const [actions, setActions] = useState<Record<string, "skip" | "replace" | "merge">>({});
  const [result, setResult] = useState<HoldingsImportConfirmResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setStep("drop");
    setPreview(null);
    setActions({});
    setResult(null);
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const data = await holdingsImportPreview(file, accountId);
      setPreview(data);
      const defaultActions: Record<string, "skip" | "replace" | "merge"> = {};
      for (const h of data.holdings) {
        if (h.is_duplicate) defaultActions[h.ticker] = "skip";
      }
      setActions(defaultActions);
      setStep("review");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'aperçu");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleConfirm = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const items: HoldingImportItem[] = preview.holdings.map((h) => ({
        ticker: h.ticker,
        name: h.name,
        quantity: h.quantity,
        cost_basis_cents: h.cost_basis_cents,
        currency: h.currency,
        asset_type: h.asset_type,
        last_price_cents: h.last_price_cents,
        duplicate_action: h.is_duplicate ? (actions[h.ticker] ?? "skip") : "skip",
      }));
      const res = await holdingsImportConfirm({ account_id: accountId, holdings: items });
      setResult(res);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["investments"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'import");
    } finally {
      setLoading(false);
    }
  };

  const newCount = preview ? preview.holdings.filter((h) => !h.is_duplicate).length : 0;
  const dupCount = preview?.duplicates ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importer des positions (CSV)</DialogTitle>
        </DialogHeader>

        {step === "drop" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors",
              dragOver ? "border-brand bg-brand/5" : "border-border",
            )}
          >
            {loading ? (
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Glissez un fichier CSV ici ou{" "}
                  <label className="cursor-pointer font-medium text-brand underline">
                    parcourir
                    <input type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
                  </label>
                </p>
                <p className="text-xs text-muted-foreground">Formats supportés : IBKR, Boursorama</p>
              </>
            )}
          </div>
        )}

        {step === "review" && preview && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                {preview.format.toUpperCase()}
              </span>
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
                          <Select
                            value={actions[h.ticker] ?? "skip"}
                            onValueChange={(v) => setActions((prev) => ({ ...prev, [h.ticker]: v as "skip" | "replace" | "merge" }))}
                          >
                            <SelectTrigger className="h-7 w-[110px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
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

            <DialogFooter>
              <Button variant="outline" onClick={() => { reset(); }}>Annuler</Button>
              <Button onClick={handleConfirm} disabled={loading}>
                {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Confirmer l&apos;import
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-4 py-6">
            <FileCheck className="size-12 text-positive" />
            <div className="space-y-1 text-center text-sm">
              {result.created > 0 && <p><span className="font-semibold">{result.created}</span> position{result.created !== 1 ? "s" : ""} créée{result.created !== 1 ? "s" : ""}</p>}
              {result.updated > 0 && <p><span className="font-semibold">{result.updated}</span> position{result.updated !== 1 ? "s" : ""} mise{result.updated !== 1 ? "s" : ""} à jour</p>}
              {result.skipped > 0 && <p><span className="font-semibold text-muted-foreground">{result.skipped}</span> ignorée{result.skipped !== 1 ? "s" : ""}</p>}
            </div>
            <Button onClick={() => handleClose(false)}>Fermer</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
