"use client";

import { useState, useCallback } from "react";
import { Upload, FileCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HoldingsImportReview, type DuplicateAction } from "./holdings-import-review";
import {
  holdingsImportPreview,
  holdingsImportConfirm,
  type HoldingsImportPreviewResponse,
  type HoldingImportItem,
  type HoldingsImportConfirmResponse,
} from "@/lib/api/hooks";

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
  const [actions, setActions] = useState<Record<string, DuplicateAction>>({});
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
      const defaultActions: Record<string, DuplicateAction> = {};
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
        isin: h.isin,
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl">
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
            <HoldingsImportReview
              preview={preview}
              actions={actions}
              onActionChange={(ticker, v) => setActions((prev) => ({ ...prev, [ticker]: v }))}
            />

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
