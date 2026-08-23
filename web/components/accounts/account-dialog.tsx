"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES } from "@/lib/format";
import { useAccountMutations, useBankProfiles, useActiveProfile, type Account } from "@/lib/api/hooks";

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  courant: "Compte courant",
  épargne: "Épargne",
  investissement: "Investissement",
  crédit: "Crédit",
  immobilier: "Immobilier",
  emprunt: "Emprunt",
};

const EMPTY = { name: "", bank_name: "", account_type: "courant", currency: "EUR", color: "#6366f1" };
const EMPTY_LOAN = { principal_cents: 0, interest_rate_pct: 0, term_months: 0, monthly_payment_cents: 0, start_date: "" };

type LoanDetailsShape = {
  principal_cents?: number | null;
  interest_rate_pct?: number | null;
  term_months?: number | null;
  monthly_payment_cents?: number | null;
  start_date?: string | null;
};

export function AccountDialog({
  open,
  onOpenChange,
  account,
  defaultType,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account: Account | null;
  defaultType?: string;
}) {
  const { create, update } = useAccountMutations();
  const { data: profiles = [] } = useBankProfiles();
  const activeProfile = useActiveProfile();

  const [form, setForm] = useState(EMPTY);
  const [loanDetails, setLoanDetails] = useState(EMPTY_LOAN);

  useEffect(() => {
    if (open) {
      setForm(
        account
          ? { name: account.name, bank_name: account.bank_name, account_type: account.account_type, currency: account.currency, color: account.color }
          : { ...EMPTY, account_type: defaultType ?? EMPTY.account_type },
      );
      const ld = account?.loan_details as LoanDetailsShape | null | undefined;
      setLoanDetails(
        ld
          ? {
              principal_cents: (ld.principal_cents || 0) / 100,
              interest_rate_pct: ld.interest_rate_pct || 0,
              term_months: ld.term_months || 0,
              monthly_payment_cents: (ld.monthly_payment_cents || 0) / 100,
              start_date: ld.start_date || "",
            }
          : EMPTY_LOAN,
      );
    }
  }, [open, account, defaultType]);

  const submit = async () => {
    try {
      const payload: any = { ...form };
      if (form.account_type === "emprunt") {
        payload.loan_details = {
          principal_cents: Math.round(loanDetails.principal_cents * 100),
          interest_rate_pct: loanDetails.interest_rate_pct,
          term_months: loanDetails.term_months || null,
          start_date: loanDetails.start_date || null,
          monthly_payment_cents: loanDetails.monthly_payment_cents > 0 ? Math.round(loanDetails.monthly_payment_cents * 100) : null,
        };
      }
      if (account) await update.mutateAsync({ id: account.id, body: payload });
      else await create.mutateAsync(payload);
      toast.success(account ? "Compte mis à jour" : "Compte créé");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const busy = create.isPending || update.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "Modifier le compte" : "Nouveau compte"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nom du compte</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Compte courant" />
          </div>
          <div className="space-y-1">
            <Label>Banque</Label>
            <Input
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              placeholder="Nom de la banque"
              list="bank-suggestions"
            />
            <datalist id="bank-suggestions">
              {profiles.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCOUNT_TYPE_LABELS)
                    .filter(([k]) => {
                      if (k === "investissement" && !activeProfile?.enabled_modules?.includes("investments")) return false;
                      if (k === "emprunt" && defaultType !== "emprunt" && !activeProfile?.enabled_modules?.includes("loans")) return false;
                      return true;
                    })
                    .map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Devise</Label>
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.symbol} — {c.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Couleur</Label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="h-9 w-16 cursor-pointer rounded-lg border border-border bg-transparent"
            />
          </div>
          
          {form.account_type === "emprunt" && (
            <div className="space-y-3 pt-3 border-t border-border mt-3">
              <p className="text-xs text-muted-foreground">
                Détails de l&apos;emprunt — l&apos;amortissement (mensualité, capital restant, date de fin) en découle.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Montant emprunté ({form.currency})</Label>
                  <Input type="number" step="1" value={loanDetails.principal_cents || ""}
                    onChange={(e) => setLoanDetails({ ...loanDetails, principal_cents: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label>Taux annuel (%)</Label>
                  <Input type="number" step="0.01" value={loanDetails.interest_rate_pct || ""}
                    onChange={(e) => setLoanDetails({ ...loanDetails, interest_rate_pct: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label>Durée (mois)</Label>
                  <Input type="number" step="1" value={loanDetails.term_months || ""}
                    onChange={(e) => setLoanDetails({ ...loanDetails, term_months: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1">
                  <Label>Date de début</Label>
                  <Input type="date" value={loanDetails.start_date}
                    onChange={(e) => setLoanDetails({ ...loanDetails, start_date: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Mensualité ({form.currency}) — optionnel</Label>
                <Input type="number" step="1" placeholder="Calculée automatiquement"
                  value={loanDetails.monthly_payment_cents || ""}
                  onChange={(e) => setLoanDetails({ ...loanDetails, monthly_payment_cents: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={busy || !form.name || !form.bank_name}>
            {busy ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
