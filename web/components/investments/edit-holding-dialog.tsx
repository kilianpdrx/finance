"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHoldingMutations, type HoldingOut } from "@/lib/api/hooks";

/** Edit a position's ticker / ISIN / name. Saving a ticker also overwrites the
 *  persistent ISIN→ticker lookup on the backend and re-fetches the live price. */
export function EditHoldingDialog({
  open,
  onOpenChange,
  holding,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  holding: HoldingOut | null;
}) {
  const { update } = useHoldingMutations();
  const [ticker, setTicker] = useState("");
  const [isin, setIsin] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (holding) {
      setTicker(holding.ticker);
      setIsin(holding.isin ?? "");
      setName(holding.name);
    }
  }, [holding]);

  const submit = async () => {
    if (!holding) return;
    try {
      await update.mutateAsync({
        holdingId: holding.id,
        body: {
          ticker: holding.asset_type === "crypto" ? ticker.trim().toLowerCase() : ticker.trim().toUpperCase(),
          isin: isin.trim() || null,
          name: name.trim(),
        },
      });
      toast.success("Position mise à jour");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la position</DialogTitle>
          <DialogDescription>
            Corrigez le symbole Yahoo ou l&apos;ISIN si le cours affiché est erroné. La correction
            est mémorisée et réutilisée lors des prochains imports.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Ticker (Yahoo)</Label>
              <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="ASML, CW8.PA…" />
            </div>
            <div className="space-y-1">
              <Label>ISIN</Label>
              <Input value={isin} onChange={(e) => setIsin(e.target.value)} placeholder="US0378331005" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={update.isPending || !ticker.trim()}>
            {update.isPending ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
