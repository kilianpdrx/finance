"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHoldingMutations, type HoldingOut } from "@/lib/api/hooks";
import { parseAmountToCents, formatCents } from "@/lib/format";

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
  const [priceLocked, setPriceLocked] = useState(false);
  const [manualPrice, setManualPrice] = useState("");

  useEffect(() => {
    if (holding) {
      setTicker(holding.ticker);
      setIsin(holding.isin ?? "");
      setName(holding.name);
      setPriceLocked(holding.price_locked ?? false);
      setManualPrice(
        holding.current_price_cents != null
          ? (holding.current_price_cents / 100).toString().replace(".", ",")
          : "",
      );
    }
  }, [holding]);

  const submit = async () => {
    if (!holding) return;
    try {
      const body: Record<string, unknown> = {
        ticker: holding.asset_type === "crypto" ? ticker.trim().toLowerCase() : ticker.trim().toUpperCase(),
        isin: isin.trim() || null,
        name: name.trim(),
        price_locked: priceLocked,
      };
      // A manual price only applies when the holding is locked out of auto-refresh.
      if (priceLocked && manualPrice.trim()) {
        body.ref_price_cents = parseAmountToCents(manualPrice);
      }
      await update.mutateAsync({ holdingId: holding.id, body });
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

          {/* Price lock — exclude from yfinance refresh, set a manual price */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <Lock className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Verrouiller le prix</p>
                  <p className="text-xs text-muted-foreground">Exclure des mises à jour automatiques (Yahoo). Utile pour un fonds sans cotation.</p>
                </div>
              </div>
              <Switch checked={priceLocked} onCheckedChange={setPriceLocked} />
            </div>
            {priceLocked && (
              <div className="space-y-1">
                <Label>Prix manuel ({holding?.currency ?? "EUR"})</Label>
                <Input
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder="ex. 147,09"
                  inputMode="decimal"
                />
                <p className="text-xs text-muted-foreground">
                  Mis à jour aussi lors d&apos;un import CSV. Valeur actuelle : {holding?.current_price_cents != null ? formatCents(holding.current_price_cents, holding.currency, { decimals: 2 }) : "—"}
                </p>
              </div>
            )}
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
