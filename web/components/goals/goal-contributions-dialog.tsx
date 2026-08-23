"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, Plus, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useGoalContributions, useGoalContributionMutations, type Goal } from "@/lib/api/hooks";

const todayISO = () => new Date().toISOString().slice(0, 10);

function Inner({ goal }: { goal: Goal }) {
  const { data: contributions = [] } = useGoalContributions(goal.id);
  const { add, remove } = useGoalContributionMutations(goal.id);

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(0);
  const [sign, setSign] = useState<1 | -1>(1);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (!amount) return;
    try {
      await add.mutateAsync({ date, amount_cents: Math.round(amount * 100) * sign, note: note || null });
      setAmount(0);
      setNote("");
      toast.success("Contribution enregistrée");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const pct = Math.min(100, Math.max(0, goal.progress_pct));

  return (
    <>
      <DialogHeader>
        <DialogTitle>{goal.name}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="nums blurable text-2xl font-bold">{formatCents(goal.current_amount_cents, "EUR")}</span>
            <span className="text-sm text-muted-foreground">/ {formatCents(goal.target_amount_cents, "EUR")}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: goal.color }} />
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setSign(1)}
              className={cn("flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                sign === 1 ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:text-foreground")}>
              <Plus className="mr-1 inline size-4" /> Dépôt
            </button>
            <button type="button" onClick={() => setSign(-1)}
              className={cn("flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                sign === -1 ? "border-negative bg-negative/10 text-negative" : "border-border text-muted-foreground hover:text-foreground")}>
              <Minus className="mr-1 inline size-4" /> Retrait
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Montant</Label>
              <Input type="number" value={amount || ""} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Note (optionnel)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex : virement mensuel, prime" />
          </div>
          <Button className="w-full" onClick={submit} disabled={!amount || add.isPending}>
            {add.isPending ? "…" : "Ajouter"}
          </Button>
        </div>

        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {contributions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Aucune contribution pour l&apos;instant.</p>
          ) : (
            contributions.map((c) => (
              <div key={c.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
                <div>
                  <p className={cn("nums blurable font-medium", c.amount_cents < 0 && "text-negative")}>
                    {formatCents(c.amount_cents, "EUR", { sign: true })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(c.date).toLocaleDateString("fr-FR")}{c.note ? ` · ${c.note}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon"
                  className="size-8 text-muted-foreground opacity-0 transition-opacity hover:text-negative group-hover:opacity-100"
                  onClick={() => remove.mutate(c.id)}>
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

export function GoalContributionsDialog({
  goal,
  onOpenChange,
}: {
  goal: Goal | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={goal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {goal && <Inner goal={goal} />}
      </DialogContent>
    </Dialog>
  );
}
