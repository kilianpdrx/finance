"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategorySelect } from "./category-select";
import { parseAmountToCents } from "@/lib/format";
import { useAccounts, useCategories, useTransactionMutations, type Transaction } from "@/lib/api/hooks";

export function TransactionDialog({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transaction?: Transaction | null;
}) {
  const { data: allAccounts = [] } = useAccounts();
  // Manual transactions only make sense on current ("courant") accounts, not
  // investment/loan/savings ones — but keep the edited transaction's own
  // account selectable even if it isn't a courant account.
  const accounts = allAccounts.filter((a) => a.account_type === "courant" || a.id === transaction?.account_id);
  const { data: categories = [] } = useCategories();
  const { create, update } = useTransactionMutations();
  const isEdit = !!transaction;

  const [accountId, setAccountId] = useState<string>("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [isDebit, setIsDebit] = useState(true);
  const [categoryId, setCategoryId] = useState<number | null>(null);

  // (Re)initialise the form whenever the dialog opens or the target changes.
  useEffect(() => {
    if (!open) return;
    if (transaction) {
      setAccountId(String(transaction.account_id));
      setDate(transaction.date.slice(0, 10));
      setDescription(transaction.description);
      setAmount((Math.abs(transaction.amount_cents) / 100).toFixed(2).replace(".", ","));
      setIsDebit(transaction.is_debit);
      setCategoryId(transaction.category_id ?? null);
    } else {
      setAccountId("");
      setDate(format(new Date(), "yyyy-MM-dd"));
      setDescription("");
      setAmount("");
      setIsDebit(true);
      setCategoryId(null);
    }
  }, [open, transaction]);

  const submit = async () => {
    const account = accounts.find((a) => a.id === Number(accountId));
    if (!account) return toast.error("Choisissez un compte");
    const amount_cents = Math.abs(parseAmountToCents(amount));
    try {
      if (isEdit && transaction) {
        await update.mutateAsync({
          id: transaction.id,
          body: {
            account_id: account.id,
            date,
            description,
            amount_cents,
            currency: account.currency,
            is_debit: isDebit,
            category_id: categoryId,
          },
        });
        toast.success("Transaction modifiée");
      } else {
        await create.mutateAsync({
          account_id: account.id,
          date,
          description,
          amount_cents,
          currency: account.currency,
          is_debit: isDebit,
          category_id: categoryId,
        });
        toast.success("Transaction créée");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEdit ? "Modifier la transaction" : "Nouvelle transaction"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Compte</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger><SelectValue placeholder="Compte" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Courses Migros" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Montant</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="42,90" />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={isDebit ? "debit" : "credit"} onValueChange={(v) => setIsDebit(v === "debit")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="debit">Dépense</SelectItem>
                  <SelectItem value="credit">Revenu</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Catégorie</Label>
            <CategorySelect value={categoryId} onChange={setCategoryId} categories={categories} accountId={Number(accountId) || undefined} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={busy || !accountId || !description || !amount}>
            {busy ? "…" : isEdit ? "Enregistrer" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
