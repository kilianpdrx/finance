"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHoldingMutations, useIbkrStatus, type HoldingOut } from "@/lib/api/hooks";
import { parseAmountToCents, formatCents } from "@/lib/format";
import { costFromUnitText, unitCostText } from "@/lib/investments";
import { isCashType } from "@/lib/asset-types";

/** Edit a position: its name, its PRU and — unless Binance keeps it up to date —
 *  its ticker / ISIN. Saving a ticker also overwrites the persistent ISIN→ticker
 *  lookup on the backend and re-fetches the live price. */
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
  const { data: ibkr } = useIbkrStatus();
  const [ticker, setTicker] = useState("");
  const [isin, setIsin] = useState("");
  const [name, setName] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [priceLocked, setPriceLocked] = useState(false);
  const [manualPrice, setManualPrice] = useState("");
  const [cashAmount, setCashAmount] = useState("");

  // Cash has no symbol, no ISIN and no quote to lock — the only thing to edit is
  // how much of it there is.
  const isCash = isCashType(holding?.asset_type);
  // A coin synced from Binance: its code and its price are Binance's.
  const fromBinance = holding?.sync_source === "binance";
  const initialUnitCost = holding ? unitCostText(holding.cost_basis_cents, holding.quantity) : "";
  const cost = holding ? costFromUnitText(unitCost, holding.quantity) : null;

  useEffect(() => {
    if (holding) {
      setTicker(holding.ticker);
      setIsin(holding.isin ?? "");
      setName(holding.name);
      setUnitCost(unitCostText(holding.cost_basis_cents, holding.quantity));
      setPriceLocked(holding.price_locked ?? false);
      setManualPrice(
        holding.current_price_cents != null
          ? (holding.current_price_cents / 100).toString().replace(".", ",")
          : "",
      );
      setCashAmount(holding.quantity ? holding.quantity.toString().replace(".", ",") : "");
    }
  }, [holding]);

  const submit = async () => {
    if (!holding) return;
    try {
      if (isCash) {
        await update.mutateAsync({
          holdingId: holding.id,
          body: { quantity: parseAmountToCents(cashAmount) / 100 },
        });
        toast.success("Liquidités mises à jour");
        onOpenChange(false);
        return;
      }
      const body: Record<string, unknown> = { name: name.trim() };
      if (!fromBinance) {
        body.ticker = holding.asset_type === "crypto" ? ticker.trim().toLowerCase() : ticker.trim().toUpperCase();
        body.isin = isin.trim() || null;
        body.price_locked = priceLocked;
        // A manual price only applies when the holding is locked out of auto-refresh.
        if (priceLocked && manualPrice.trim()) {
          body.ref_price_cents = parseAmountToCents(manualPrice);
        }
      }
      // Only a PRU the user changed: re-deriving an untouched one from its
      // rounded display would move the stored cost by a cent.
      if (unitCost.trim() !== initialUnitCost) body.cost_basis_cents = cost;
      await update.mutateAsync({ holdingId: holding.id, body });
      toast.success("Position mise à jour");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const invalid = isCash ? !cashAmount.trim() : (!fromBinance && !ticker.trim()) || !name.trim() || cost === undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCash ? "Modifier les liquidités" : "Modifier la position"}</DialogTitle>
          <DialogDescription>
            {isCash
              ? fromBinance
                ? "Les euros présents sur Binance : la synchronisation met ce montant à jour."
                : "Le montant non investi présent sur ce compte. Il compte dans le patrimoine mais n'est pas coté."
              : fromBinance
                ? "Synchronisée depuis Binance : la quantité et le cours viennent de Binance. Indiquez ce que vous avez payé pour voir le gain."
                : "Corrigez le symbole Yahoo ou l'ISIN si le cours affiché est erroné. La correction est mémorisée et réutilisée lors des prochains imports."}
          </DialogDescription>
        </DialogHeader>
        {isCash ? (
          <div className="space-y-1">
            <Label>Montant ({holding?.currency ?? "EUR"})</Label>
            <Input
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="1 500,00"
              inputMode="decimal"
            />
          </div>
        ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nom</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {fromBinance ? (
            <div className="space-y-1">
              <Label>Code Binance</Label>
              <Input value={holding?.ticker ?? ""} disabled />
            </div>
          ) : (
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
          )}

          {/* PRU — the cost per unit; the total follows the quantity */}
          <div className="space-y-1">
            <Label htmlFor="holding-unit-cost">Prix de revient unitaire (PRU, {holding?.currency ?? "EUR"})</Label>
            <Input
              id="holding-unit-cost"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="Inconnu"
              inputMode="decimal"
              aria-invalid={cost === undefined}
            />
            <p className="text-xs text-muted-foreground">
              {cost === undefined
                ? "Saisissez un nombre, par exemple 48 000,00."
                : cost == null
                  ? "Laissé vide, le prix de revient est inconnu : la position n'a pas de gain."
                  : `Coût total : ${formatCents(cost, holding?.currency ?? "EUR", { decimals: 2 })} pour ${holding?.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 8 })}.`}
              {fromBinance && " La synchronisation garde ce PRU quand la quantité change : après un achat, mettez-le à jour."}
              {!fromBinance && ibkr?.account_id != null && holding?.account_id === ibkr.account_id
                && " IBKR le remplace à chaque synchronisation."}
            </p>
          </div>

          {/* Price lock — exclude from yfinance refresh, set a manual price */}
          {!fromBinance && (
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
          )}
        </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={update.isPending || invalid}>
            {update.isPending ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
