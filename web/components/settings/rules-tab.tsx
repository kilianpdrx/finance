"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Merge, FlaskConical, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, unwrap } from "@/lib/api/client";
import { useAllRules, useCategories, useRuleMutations, type CategoryRule, type Account, type Transaction } from "@/lib/api/hooks";
import { groupByAccount } from "@/lib/group";
import { formatCents } from "@/lib/format";
import { ConflictBadge } from "@/components/transactions/conflict-badge";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const FIELDS = [
  { value: "description", label: "Libellé" },
  { value: "amount", label: "Montant" },
  { value: "is_debit", label: "Débit ?" },
  { value: "currency", label: "Devise" },
  { value: "account_id", label: "Compte (ID)" },
  { value: "date", label: "Date" },
];
const ORDER_MAP: Record<string, number> = { first: 5, standard: 100, last: 500 };
const orderOf = (p: number) => (p <= 10 ? "first" : p <= 100 ? "standard" : "last");

function operatorsFor(field: string) {
  if (field === "amount") return [{ value: ">", label: ">" }, { value: ">=", label: "≥" }, { value: "<", label: "<" }, { value: "<=", label: "≤" }, { value: "equals", label: "=" }];
  if (field === "is_debit") return [{ value: "equals", label: "est (true/false)" }];
  return [{ value: "contains", label: "contient" }, { value: "startswith", label: "commence par" }, { value: "equals", label: "égal à" }, { value: "regex", label: "regex" }];
}

type Cond = { field: string; operator: string; value: string };

export function RulesTab({ accounts }: { accounts: Account[] }) {
  const { data: rules = [] } = useAllRules();
  const { data: categories = [] } = useCategories();
  const { create, update, remove, merge } = useRuleMutations();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [conditions, setConditions] = useState<Cond[]>([{ field: "description", operator: "contains", value: "" }]);
  const [logic, setLogic] = useState<"AND" | "OR">("AND");
  const [categoryId, setCategoryId] = useState<number>(0);
  const [order, setOrder] = useState("standard");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Transaction[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`;
  const catColor = (id: number) => categories.find((c) => c.id === id)?.color ?? "var(--muted-foreground)";
  const groups = useMemo(() => groupByAccount(rules, accounts), [rules, accounts]);

  const openCreate = () => {
    setEditing(null); setConditions([{ field: "description", operator: "contains", value: "" }]);
    setLogic("AND"); setCategoryId(categories[0]?.id ?? 0); setOrder("standard"); setAccountId(null); setPreview(null); setOpen(true);
  };
  const openEdit = (r: CategoryRule) => {
    setEditing(r); setConditions(r.conditions.map((c) => ({ ...c }))); setLogic((r.logic_operator as "AND" | "OR") ?? "AND");
    setCategoryId(r.category_id); setOrder(orderOf(r.priority)); setAccountId(r.account_id ?? null); setPreview(null); setOpen(true);
  };

  const runPreview = async () => {
    try {
      const res = await unwrap(api.POST("/api/categories/rules/preview", { body: { conditions, account_id: accountId, logic_operator: logic } })) as Transaction[];
      setPreview(res);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const submit = async () => {
    const body = { conditions, category_id: categoryId, priority: ORDER_MAP[order], is_active: editing?.is_active ?? true, account_id: accountId, logic_operator: logic };
    try {
      if (editing) await update.mutateAsync({ ruleId: editing.id, body });
      else await create.mutateAsync({ categoryId, body });
      toast.success(editing ? "Règle mise à jour" : "Règle créée");
      setOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const doMerge = async () => {
    try { await merge.mutateAsync({ ruleIds: [...selected], logicOperator: "OR" }); toast.success("Règles fusionnées"); setSelected(new Set()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rules.length} règles · triées par priorité</p>
        <div className="flex gap-2">
          {selected.size >= 2 && <Button variant="outline" size="sm" onClick={doMerge}><Merge className="size-4" /> Fusionner ({selected.size})</Button>}
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> Règle</Button>
        </div>
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} · {g.items.length}</h3>
            <Card className="divide-y divide-border p-0">
              {g.items.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={() => setSelected((p) => { const n = new Set(p); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: catColor(r.category_id) }} />
                  <span className="w-40 shrink-0 truncate text-sm font-medium">{catName(r.category_id)}</span>
                  <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                    {r.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(` ${r.logic_operator} `)}
                  </span>
                  <Badge variant="neutral">{orderOf(r.priority)}</Badge>
                  <Switch checked={r.is_active} onCheckedChange={(v) => update.mutate({ ruleId: r.id, body: { is_active: v } })} />
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" onClick={() => remove.mutate(r.id)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Modifier la règle" : "Nouvelle règle"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Catégorie</Label>
                <Select value={String(categoryId)} onValueChange={(v) => setCategoryId(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
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
                  {preview.length} transaction(s) correspond(ent) à ces conditions.
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
          <DialogFooter>
            <Button variant="outline" onClick={runPreview}><FlaskConical className="size-4" /> Tester</Button>
            <Button onClick={submit} disabled={!categoryId || conditions.some((c) => !c.value)}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
