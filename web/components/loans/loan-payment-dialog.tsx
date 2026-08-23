"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents } from "@/lib/format";
import { useLoanPaymentMutations, type Loan } from "@/lib/api/hooks";

const todayISO = () => new Date().toISOString().slice(0, 10);

function Inner({ loan }: { loan: Loan }) {
  const { add, remove } = useLoanPaymentMutations(loan.id);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!amount) return;
    try {
      await add.mutateAsync({ date, amount_cents: Math.round(amount * 100), note: note || null });
      setAmount(0);
      setNote("");
      toast.success("Paiement enregistré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Paiements anticipés — {loan.name}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Un paiement anticipé réduit le capital restant et raccourcit la durée du prêt.</p>
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Montant ({loan.currency})</Label>
              <Input type="number" value={amount || ""} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Note (optionnel)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex : remboursement partiel" />
          </div>
          <Button className="w-full" onClick={submit} disabled={!amount || add.isPending}>
            {add.isPending ? "…" : "Enregistrer"}
          </Button>
        </div>
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {loan.extra_payments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Aucun paiement anticipé.</p>
          ) : (
            loan.extra_payments.map((p) => (
              <div key={p.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <div>
                  <p className="nums blurable font-medium">{formatCents(p.amount_cents, loan.currency)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.date).toLocaleDateString("fr-FR")}{p.note ? ` · ${p.note}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon"
                  className="size-8 text-muted-foreground opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                  onClick={() => remove.mutate(p.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

export function LoanPaymentDialog({
  loan,
  onOpenChange,
}: {
  loan: Loan | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={loan !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {loan && <Inner loan={loan} />}
      </DialogContent>
    </Dialog>
  );
}
