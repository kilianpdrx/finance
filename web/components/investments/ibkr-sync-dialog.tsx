"use client";

import { useState, useEffect, useCallback } from "react";
import { FileCheck, Loader2, DownloadCloud, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HoldingsImportReview, type DuplicateAction } from "./holdings-import-review";
import {
  useIbkrSyncPreview,
  holdingsImportConfirm,
  type HoldingsImportPreviewResponse,
  type HoldingImportItem,
  type HoldingsImportConfirmResponse,
} from "@/lib/api/hooks";

type Step = "loading" | "review" | "done" | "error";

export function IbkrSyncDialog({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId?: number;
}) {
  const qc = useQueryClient();
  const syncPreview = useIbkrSyncPreview();
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<HoldingsImportPreviewResponse | null>(null);
  const [actions, setActions] = useState<Record<string, DuplicateAction>>({});
  const [result, setResult] = useState<HoldingsImportConfirmResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("loading");
    setPreview(null);
    setActions({});
    setResult(null);
    setErrorMsg("");
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // Kick off the fetch when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("loading");
    syncPreview
      .mutateAsync(accountId)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        const defaults: Record<string, DuplicateAction> = {};
        for (const h of data.holdings) {
          if (h.is_duplicate) defaults[h.ticker] = "replace";
        }
        setActions(defaults);
        setStep("review");
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Échec de la synchronisation IBKR");
        setStep("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  const handleConfirm = useCallback(async () => {
    if (!preview || accountId == null) return;
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
        duplicate_action: h.is_duplicate ? (actions[h.ticker] ?? "replace") : "skip",
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
  }, [preview, accountId, actions, qc]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadCloud className="size-4" /> Synchroniser depuis IBKR
          </DialogTitle>
        </DialogHeader>

        {step === "loading" && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Récupération des positions depuis IBKR…</p>
            <p className="text-xs text-muted-foreground">Le relevé peut prendre quelques secondes à se générer.</p>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <AlertTriangle className="size-10 text-warning" />
            <p className="max-w-md text-center text-sm text-muted-foreground">{errorMsg}</p>
            <Button onClick={() => handleClose(false)}>Fermer</Button>
          </div>
        )}

        {step === "review" && preview && (
          <div className="space-y-4">
            {preview.holdings.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Aucune position ouverte trouvée dans le relevé IBKR.</p>
            ) : (
              <HoldingsImportReview
                preview={preview}
                actions={actions}
                onActionChange={(ticker, v) => setActions((prev) => ({ ...prev, [ticker]: v }))}
              />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Annuler</Button>
              <Button onClick={handleConfirm} disabled={loading || preview.holdings.length === 0}>
                {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Confirmer la synchronisation
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
