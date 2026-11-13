"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAccounts, usePayrollEmployers, usePayrollMutations, type Employer } from "@/lib/api/hooks";

const NO_ACCOUNT = "__none__";

/** « Employeurs »: their name, the account the salary arrives in, and a word
 *  of the deposit's label when two salaries arrive in the same account. */
export function EmployersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: employers = [] } = usePayrollEmployers();
  const { data: accounts = [] } = useAccounts();
  const { updateEmployer, deleteEmployer } = usePayrollMutations();
  const confirm = useConfirm();
  const [edits, setEdits] = useState<Record<number, Employer>>({});
  useEffect(() => { if (open) setEdits(Object.fromEntries(employers.map((e) => [e.id, e]))); }, [open, employers]);

  const save = (e: Employer) => updateEmployer.mutate({ id: e.id, body: {
    name: e.name, currency: e.currency, account_id: e.account_id, label_hint: e.label_hint,
  } }, {
    onSuccess: () => toast.success(`« ${e.name} » enregistré`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  });
  const remove = async (e: Employer) => {
    if (!(await confirm({ title: `Supprimer « ${e.name} » ?`, description: "Ses classements de lignes partent avec lui.", destructive: true, confirmLabel: "Supprimer" }))) return;
    deleteEmployer.mutate(e.id, { onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur") });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Employeurs</DialogTitle>
          <DialogDescription>Le compte où arrive le salaire permet de retrouver chaque versement.</DialogDescription>
        </DialogHeader>
        {employers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Un employeur s&apos;ajoute en important sa première fiche de paie.</p>
        ) : (
          <ul className="space-y-3">
            {employers.map((original) => {
              const e = edits[original.id] ?? original;
              const set = (change: Partial<Employer>) => setEdits((all) => ({ ...all, [e.id]: { ...e, ...change } }));
              return (
                <li key={e.id} className="space-y-2 rounded-xl border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_12rem_9rem]">
                    <Input aria-label="Nom" value={e.name} onChange={(ev) => set({ name: ev.target.value })} />
                    <Select value={e.account_id != null ? String(e.account_id) : NO_ACCOUNT}
                      onValueChange={(v) => set({ account_id: v === NO_ACCOUNT ? null : Number(v) })}>
                      <SelectTrigger aria-label={`Compte de ${e.name}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ACCOUNT}>Aucun compte</SelectItem>
                        {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} · {a.currency}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input aria-label={`Mot du libellé de ${e.name}`} placeholder="mot du libellé" value={e.label_hint ?? ""}
                      onChange={(ev) => set({ label_hint: ev.target.value })} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{original.payslip_count} fiche{original.payslip_count > 1 ? "s" : ""} · {e.currency}</span>
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-negative" disabled={original.payslip_count > 0}
                        title={original.payslip_count > 0 ? "Supprimez d'abord ses fiches de paie" : undefined} onClick={() => remove(original)}>
                        <Trash2 className="mr-1 size-3.5" /> Supprimer
                      </Button>
                      <Button size="sm" onClick={() => save(e)} disabled={!e.name.trim()}>Enregistrer</Button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
