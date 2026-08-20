"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHoldingMutations } from "@/lib/api/hooks";
import { parseAmountToCents, CURRENCIES } from "@/lib/format";

const ASSET_TYPES = [
  { value: "stock", label: "Action" },
  { value: "etf", label: "ETF" },
  { value: "crypto", label: "Crypto" },
  { value: "bond", label: "Obligation" },
  { value: "fund", label: "Fonds" },
  { value: "cash", label: "Liquidités" },
];

const EMPTY = { ticker: "", name: "", quantity: "", costBasis: "", currency: "USD", assetType: "stock" };

export function AddHoldingDialog({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: number;
}) {
  const { create } = useHoldingMutations();
  const [form, setForm] = useState(EMPTY);

  // Cash has no ticker, no name and no cost basis — the amount IS the position.
  // The backend derives CASH.{devise} and pins the price, so those fields are
  // hidden rather than asked for and thrown away.
  const isCash = form.assetType === "cash";

  const submit = async () => {
    try {
      await create.mutateAsync({
        accountId,
        body: {
          ticker: isCash
            ? "cash"
            : form.assetType === "crypto"
              ? form.ticker.toLowerCase()
              : form.ticker.toUpperCase(),
          name: isCash ? "" : form.name,
          quantity: isCash
            ? parseAmountToCents(form.quantity) / 100
            : parseFloat(form.quantity),
          cost_basis_cents: isCash ? 0 : parseAmountToCents(form.costBasis),
          currency: form.currency,
          asset_type: form.assetType,
        },
      });
      toast.success("Position ajoutée");
      setForm(EMPTY);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const valid = isCash
    ? Boolean(form.quantity) && parseAmountToCents(form.quantity) >= 0
    : Boolean(form.ticker && form.name && form.quantity && form.costBasis);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une position</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!isCash && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Ticker / ID</Label>
                  <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} placeholder="AAPL, bitcoin…" />
                </div>
                <div className="space-y-1">
                  <Label>Nom</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Apple Inc." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Quantité</Label>
                  <Input inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="10" />
                </div>
                <div className="space-y-1">
                  <Label>Coût d'acquisition total</Label>
                  <Input inputMode="decimal" value={form.costBasis} onChange={(e) => setForm({ ...form, costBasis: e.target.value })} placeholder="1 500,00" />
                </div>
              </div>
            </>
          )}
          {isCash && (
            <div className="space-y-1">
              <Label>Montant</Label>
              <Input
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder="1 500,00"
              />
              <p className="text-xs text-muted-foreground">
                Les liquidités non investies du compte. Elles comptent dans le
                patrimoine mais ne sont pas cotées.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type d'actif</Label>
              <Select value={form.assetType} onValueChange={(v) => setForm({ ...form, assetType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{isCash ? "Devise" : "Devise de cotation"}</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.symbol} — {c.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={create.isPending || !valid}>
            {create.isPending ? "…" : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
