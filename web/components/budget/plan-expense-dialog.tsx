"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { orderCategoryTree } from "@/lib/group";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAccounts, useCategories, usePlannedExpenseMutations } from "@/lib/api/hooks";

const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

type EndMode = "year" | "count" | "until";

export function PlanExpenseDialog({
  open,
  onOpenChange,
  accountId,
  prefill,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId?: number | null;
  prefill?: { categoryId?: number; month?: string } | null;
}) {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { create, createRecurring } = usePlannedExpenseMutations();

  // Categories relevant to the account currently shown in the budget table:
  // a specific account → its own + shared (all-account) categories; "all" → any
  // of the courant accounts' categories + shared ones.
  const courantIds = accounts.filter((a) => a.account_type === "courant").map((a) => a.id);
  const relevantIds = accountId != null ? [accountId] : courantIds;
  const acctName = (id: number | null | undefined) => (id == null ? null : accounts.find((a) => a.id === id)?.name ?? null);
  const visibleCats = categories
    .filter((c) => !c.archived && (c.account_id == null || relevantIds.includes(c.account_id)))
    .sort((a, b) => Number(b.is_income) - Number(a.is_income) || a.name.localeCompare(b.name));

  const [categoryId, setCategoryId] = useState<number | 0>(0);
  const [month, setMonth] = useState(thisMonth());
  const [amount, setAmount] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [everyN, setEveryN] = useState(1);
  const [endMode, setEndMode] = useState<EndMode>("year");
  const [count, setCount] = useState(6);
  const [endMonth, setEndMonth] = useState("");

  useEffect(() => {
    if (!open) return;
    setCategoryId(prefill?.categoryId ?? 0);
    setMonth(prefill?.month ?? thisMonth());
    setAmount(0);
    setRepeat(false);
    setEveryN(1);
    setEndMode("year");
    setCount(6);
    setEndMonth("");
  }, [open, prefill]);

  const submit = async () => {
    if (!categoryId || amount <= 0) {
      toast.error("Choisissez une catégorie et un montant.");
      return;
    }
    const amount_cents = Math.round(amount * 100);
    const account_id = accountId ?? null;
    try {
      if (!repeat) {
        await create.mutateAsync({ category_id: categoryId, month, amount_cents, account_id });
        toast.success("Dépense planifiée");
      } else {
        const res: { created: number } = await createRecurring.mutateAsync({
          category_id: categoryId,
          start_month: month,
          amount_cents,
          account_id,
          every_n_months: Math.max(1, everyN),
          end_mode: endMode,
          count: endMode === "count" ? Math.max(1, count) : null,
          end_month: endMode === "until" ? endMonth || null : null,
        });
        toast.success(`${res.created} dépense(s) planifiée(s)`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const busy = create.isPending || createRecurring.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Planifier un montant</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Catégorie</Label>
            <Select value={categoryId ? String(categoryId) : ""} onValueChange={(v) => setCategoryId(parseInt(v))}>
              <SelectTrigger><SelectValue placeholder="Choisir une catégorie" /></SelectTrigger>
              <SelectContent>
                {orderCategoryTree(visibleCats).map(({ cat: c, child }) => {
                  const an = acctName(c.account_id);
                  return (
                    <SelectItem key={c.id} value={String(c.id)} className={child ? "pl-9" : undefined}>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                        <span>{c.name}</span>
                        {c.is_income && <Badge variant="neutral" className="text-[10px]">Revenu</Badge>}
                        {an && <Badge variant="neutral" className="text-[10px]">{an}</Badge>}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{repeat ? "Mois de départ" : "Mois"}</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Montant</Label>
              <Input type="number" value={amount || ""} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          {/* Recurrence toggle */}
          <div className="flex gap-2">
            {[
              { v: false, label: "Une fois" },
              { v: true, label: "Récurrent" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setRepeat(o.v)}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                  repeat === o.v ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {repeat && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Tous les</span>
                <Input type="number" min={1} value={everyN} onChange={(e) => setEveryN(parseInt(e.target.value) || 1)} className="w-16" />
                <span className="text-muted-foreground">mois</span>
              </div>
              <div className="space-y-1">
                <Label>Jusqu&apos;à</Label>
                <Select value={endMode} onValueChange={(v) => setEndMode(v as EndMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="year">La fin de l&apos;année</SelectItem>
                    <SelectItem value="count">Un nombre d&apos;occurrences</SelectItem>
                    <SelectItem value="until">Un mois précis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {endMode === "count" && (
                <div className="flex items-center gap-2 text-sm">
                  <Input type="number" min={1} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} className="w-20" />
                  <span className="text-muted-foreground">occurrence(s)</span>
                </div>
              )}
              {endMode === "until" && (
                <div className="space-y-1">
                  <Label>Mois de fin</Label>
                  <Input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={submit} disabled={busy || !categoryId || amount <= 0}>
            {busy ? "…" : "Planifier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
