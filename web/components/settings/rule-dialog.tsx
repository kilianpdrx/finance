"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, FlaskConical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, unwrap } from "@/lib/api/client";
import { useCategories, useRuleMutations, useCategoryMutations, type CategoryRule, type Account, type Transaction } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { ConflictBadge } from "@/components/transactions/conflict-badge";
import { CategorySelect } from "@/components/transactions/category-select";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const FIELDS = [
  { value: "description", label: "Libellé" },
  { value: "amount", label: "Montant" },
  { value: "is_debit", label: "Débit ?" },
  { value: "currency", label: "Devise" },
  { value: "account_id", label: "Compte (ID)" },
  { value: "date", label: "Date" },
];
export const ORDER_MAP: Record<string, number> = { first: 5, standard: 100, last: 500 };
export const orderOf = (p: number) => (p <= 10 ? "first" : p <= 100 ? "standard" : "last");

export function operatorsFor(field: string) {
  if (field === "amount") return [{ value: ">", label: ">" }, { value: ">=", label: "≥" }, { value: "<", label: "<" }, { value: "<=", label: "≤" }, { value: "equals", label: "=" }];
  if (field === "is_debit") return [{ value: "equals", label: "est (true/false)" }];
  return [{ value: "contains", label: "contient" }, { value: "startswith", label: "commence par" }, { value: "equals", label: "égal à" }, { value: "regex", label: "regex" }];
}

type Cond = { field: string; operator: string; value: string };

/** The full categorization-rule editor: conditions builder + live "Tester"
 *  preview. Reused for creating/editing rules and for turning a recurring
 *  transaction into a rule (via `prefill`). */
export function RuleDialog({
  open,
  onOpenChange,
  accounts,
  editing = null,
  prefill = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  editing?: CategoryRule | null;
  prefill?: { description?: string; categoryId?: number | null } | null;
}) {
  const { data: categories = [] } = useCategories();
  const { create, update } = useRuleMutations();
  const { rescan } = useCategoryMutations();

  const [conditions, setConditions] = useState<Cond[]>([{ field: "description", operator: "contains", value: "" }]);
  const [logic, setLogic] = useState<"AND" | "OR">("AND");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [order, setOrder] = useState("standard");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Transaction[] | null>(null);

  // Initialize form each time the dialog opens, from `editing` or `prefill`.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    if (editing) {
      setConditions(editing.conditions.map((c) => ({ ...c })));
      setLogic((editing.logic_operator as "AND" | "OR") ?? "AND");
      setCategoryId(editing.category_id);
      setOrder(orderOf(editing.priority));
      setAccountId(editing.account_id ?? null);
    } else {
      setConditions([{ field: "description", operator: "contains", value: prefill?.description ?? "" }]);
      setLogic("AND");
      setCategoryId(prefill?.categoryId ?? categories[0]?.id ?? 0);
      setOrder("standard");
      setAccountId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reapply = () =>
    rescan.mutate(undefined, {
      onSuccess: (r) => toast.success(`${(r as { updated: number }).updated} transaction(s) recatégorisée(s)`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });

  const runPreview = async () => {
    try {
      const res = (await unwrap(api.POST("/api/categories/rules/preview", {
        params: { query: { limit: 200 } },
        body: { conditions, account_id: accountId, logic_operator: logic },
      }))) as Transaction[];
      setPreview(res);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const submit = async () => {
    const body = { conditions, category_id: categoryId, priority: ORDER_MAP[order], is_active: editing?.is_active ?? true, account_id: accountId, logic_operator: logic };
    try {
      if (editing) await update.mutateAsync({ ruleId: editing.id, body });
      else await create.mutateAsync({ categoryId, body });
      onOpenChange(false);
      toast.success(editing ? "Règle mise à jour" : "Règle créée", {
        action: { label: "Appliquer", onClick: reapply },
      });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader className="shrink-0"><DialogTitle>{editing ? "Modifier la règle" : "Nouvelle règle"}</DialogTitle></DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Catégorie</Label>
              <CategorySelect value={categoryId || null} onChange={(v) => v != null && setCategoryId(v)}
                categories={categories} accountId={accountId} hideNone placeholder="Choisir…" />
            </div>
            <div className="space-y-1"><Label>Priorité</Label>
              <Select value={order} onValueChange={setOrder}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="first">En premier</SelectItem><SelectItem value="standard">Standard</SelectItem><SelectItem value="last">En dernier</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Compte</Label>
              <Select value={accountId == null ? "all" : String(accountId)} onValueChange={(v) => setAccountId(v === "all" ? null : Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Tous</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Label>Conditions</Label>
            {conditions.length > 1 && (
              <div className="flex rounded-lg bg-muted p-0.5">
                {(["AND", "OR"] as const).map((l) => (
                  <button key={l} onClick={() => setLogic(l)} className={`rounded-md px-2 py-0.5 text-xs font-medium ${logic === l ? "bg-brand text-brand-foreground" : "text-muted-foreground"}`}>{l === "AND" ? "ET" : "OU"}</button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {conditions.map((cond, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select value={cond.field} onValueChange={(v) => setConditions((cs) => cs.map((c, i) => i === idx ? { ...c, field: v, operator: operatorsFor(v)[0].value } : c))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={cond.operator} onValueChange={(v) => setConditions((cs) => cs.map((c, i) => i === idx ? { ...c, operator: v } : c))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{operatorsFor(cond.field).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="flex-1" placeholder="Valeur" value={cond.value} onChange={(e) => setConditions((cs) => cs.map((c, i) => i === idx ? { ...c, value: e.target.value } : c))} />
                {conditions.length > 1 && <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => setConditions((cs) => cs.filter((_, i) => i !== idx))}><X className="size-4" /></Button>}
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setConditions((cs) => [...cs, { field: "description", operator: "contains", value: "" }])}><Plus className="size-4" /> Condition</Button>
          </div>

          {preview != null && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-brand">
                {preview.length}{preview.length >= 200 ? "+" : ""} transaction(s) correspond(ent) à ces conditions.
              </p>
              {preview.length > 0 && (
                <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {preview.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                      <span className="nums w-16 shrink-0 text-muted-foreground">{format(new Date(t.date), "dd MMM yy", { locale: fr })}</span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate">{t.description}</span>
                        {t.category_conflict && <ConflictBadge className="shrink-0 text-[10px]" />}
                      </span>
                      <span className="shrink-0 truncate text-muted-foreground">{t.account_name}</span>
                      <span className={`nums w-24 shrink-0 text-right font-semibold ${t.is_debit ? "text-negative" : "text-positive"}`}>
                        {t.is_debit ? "−" : "+"}{formatCents(t.amount_cents, t.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={runPreview}><FlaskConical className="size-4" /> Tester</Button>
          <Button onClick={submit} disabled={!categoryId || conditions.some((c) => !c.value)}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
