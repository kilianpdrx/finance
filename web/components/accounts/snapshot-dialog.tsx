"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents, parseAmountToCents } from "@/lib/format";
import { useSnapshots, useSnapshotMutations, type Account } from "@/lib/api/hooks";

export function SnapshotDialog({
  account,
  onOpenChange,
}: {
  account: Account | null;
  onOpenChange: (v: boolean) => void;
}) {
  const accountId = account?.id ?? null;
  const { data: snapshots = [] } = useSnapshots(accountId);
  const { create, remove } = useSnapshotMutations();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const save = async () => {
    if (!account) return;
    try {
      await create.mutateAsync({
        accountId: account.id,
        body: { date, amount_cents: parseAmountToCents(amount), contribution_cents: 0, currency: account.currency, notes: notes || null },
      });
      toast.success("Solde enregistré");
      setAmount("");
      setNotes("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Dialog open={account != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Soldes manuels — {account?.name}</DialogTitle>
          <DialogDescription>
            Saisissez le solde réel du compte à une date donnée. Le patrimoine sera recalculé en conséquence.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Montant ({account?.currency})</Label>
              <Input placeholder="12 345,67" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optionnel)</Label>
            <Input placeholder="Ex: Solde au relevé de décembre" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="w-full" onClick={save} disabled={create.isPending || !amount || !date}>
            {create.isPending ? "…" : "Enregistrer ce solde"}
          </Button>
        </div>

        {snapshots.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historique</p>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {snapshots.map((snap) => (
                <div key={snap.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <div>
                    <p className="nums text-sm font-medium">{formatCents(snap.amount_cents, snap.currency)}</p>
                    <p className="text-xs text-muted-foreground">{snap.date}{snap.notes ? ` · ${snap.notes}` : ""}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-negative"
                    onClick={() => account && remove.mutate({ accountId: account.id, snapshotId: snap.id })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
