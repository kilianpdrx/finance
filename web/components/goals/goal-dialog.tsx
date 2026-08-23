"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useGoalMutations, useAccounts, type Goal, type GoalCreate, type GoalUpdate } from "@/lib/api/hooks";

type Mode = "manual" | "linked";

const EMPTY = { name: "", target: 0, initial: 0, deadline: "", color: "#6366f1", linkedAccountId: 0 };

export function GoalDialog({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  goal: Goal | null;
}) {
  const { create, update } = useGoalMutations();
  const { data: accounts = [] } = useAccounts();
  const savingsAccounts = accounts.filter((a) => a.account_type === "épargne");

  const [mode, setMode] = useState<Mode>("manual");
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (goal) {
      setMode(goal.is_linked ? "linked" : "manual");
      setForm({
        name: goal.name,
        target: goal.target_amount_cents / 100,
        initial: 0,
        deadline: goal.deadline || "",
        color: goal.color,
        linkedAccountId: goal.linked_account_id || 0,
      });
    } else {
      setMode("manual");
      setForm(EMPTY);
    }
  }, [open, goal]);

  const submit = async () => {
    try {
      const linkedId = mode === "linked" && form.linkedAccountId > 0 ? form.linkedAccountId : null;
      if (mode === "linked" && !linkedId) {
        toast.error("Sélectionnez un compte à lier.");
        return;
      }

      if (goal) {
        const body: GoalUpdate = {
          name: form.name,
          target_amount_cents: Math.round(form.target * 100),
          color: form.color,
          deadline: form.deadline || null,
          linked_account_id: linkedId,
        };
        await update.mutateAsync({ id: goal.id, body });
      } else {
        const body: GoalCreate = {
          name: form.name,
          target_amount_cents: Math.round(form.target * 100),
          color: form.color,
          deadline: form.deadline || null,
          linked_account_id: linkedId,
          initial_amount_cents: linkedId ? 0 : Math.round(form.initial * 100),
        };
        await create.mutateAsync(body);
      }
      toast.success(goal ? "Objectif mis à jour" : "Objectif créé");
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
          <DialogTitle>{goal ? "Modifier l'objectif" : "Nouvel objectif"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Nom</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex : Voyage au Japon" />
          </div>

          <div className="space-y-1">
            <Label>Montant cible</Label>
            <Input type="number" value={form.target || ""} onChange={(e) => setForm({ ...form, target: parseFloat(e.target.value) || 0 })} />
          </div>

          {/* Tracking mode */}
          <div className="space-y-1.5">
            <Label>Suivi de la progression</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["manual", "linked"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    mode === m ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "manual" ? "Contributions manuelles" : "Compte lié (auto)"}
                </button>
              ))}
            </div>
          </div>

          {mode === "linked" ? (
            <div className="space-y-1">
              <Label>Compte d&apos;épargne lié</Label>
              <p className="text-xs text-muted-foreground">La progression suivra automatiquement le solde de ce compte.</p>
              <Select value={form.linkedAccountId.toString()} onValueChange={(v) => setForm({ ...form, linkedAccountId: parseInt(v) })}>
                <SelectTrigger><SelectValue placeholder="Sélectionner un compte" /></SelectTrigger>
                <SelectContent>
                  {savingsAccounts.length === 0 && <SelectItem value="0" disabled>Aucun compte épargne</SelectItem>}
                  {savingsAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            !goal && (
              <div className="space-y-1">
                <Label>Déjà épargné (optionnel)</Label>
                <p className="text-xs text-muted-foreground">Enregistré comme première contribution.</p>
                <Input type="number" value={form.initial || ""} onChange={(e) => setForm({ ...form, initial: parseFloat(e.target.value) || 0 })} />
              </div>
            )
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date limite (optionnel)</Label>
              <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Couleur</Label>
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="h-9 w-16 cursor-pointer rounded-lg border border-border bg-transparent mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={busy || !form.name || form.target <= 0}>
            {busy ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
