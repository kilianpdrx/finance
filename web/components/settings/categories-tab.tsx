"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccounts, useCategories, useCategoryMutations, type Category } from "@/lib/api/hooks";
import { groupByAccount } from "@/lib/group";

type TypeKey = "income" | "fixed" | "variable";
const TYPE_LABEL: Record<TypeKey, string> = { income: "Revenu", fixed: "Dépense fixe", variable: "Dépense variable" };

function typeOf(c: Category): TypeKey {
  if (c.is_income) return "income";
  return c.expense_type === "fixed" ? "fixed" : "variable";
}

export function CategoriesTab() {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { create, update, remove, rescan } = useCategoryMutations();
  const groups = useMemo(() => groupByAccount(categories, accounts), [categories, accounts]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [type, setType] = useState<TypeKey>("variable");
  const [isInvestment, setIsInvestment] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setColor(editing?.color ?? "#10b981");
      setType(editing ? typeOf(editing) : "variable");
      setIsInvestment(editing?.is_investment ?? false);
    }
  }, [open, editing]);

  const submit = async () => {
    const body = {
      name, color, icon: editing?.icon ?? "tag",
      is_income: type === "income",
      expense_type: type === "income" ? null : type,
      is_investment: isInvestment,
      account_id: editing?.account_id ?? null,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      toast.success(editing ? "Catégorie mise à jour" : "Catégorie créée");
      setOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const onDelete = (c: Category) => {
    if (confirm(`Supprimer « ${c.name} » ? Les transactions seront reclassées.`)) remove.mutate({ id: c.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{categories.length} catégories</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => rescan.mutate(undefined, { onSuccess: (r) => toast.success(`${(r as { updated: number }).updated} transactions recatégorisées`) })} disabled={rescan.isPending}>
            <RefreshCw className={`size-4 ${rescan.isPending ? "animate-spin" : ""}`} /> Rescanner
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="size-4" /> Catégorie</Button>
        </div>
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} · {g.items.length}</h3>
            <Card className="divide-y divide-border p-0">
              {g.items.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                  {c.is_investment && <Badge variant="brand">Invest.</Badge>}
                  <Badge variant={c.is_income ? "positive" : "neutral"}>{TYPE_LABEL[typeOf(c)]}</Badge>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => { setEditing(c); setOpen(true); }}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" onClick={() => onDelete(c)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Nom</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as TypeKey)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(TYPE_LABEL) as TypeKey[]).map((k) => <SelectItem key={k} value={k}>{TYPE_LABEL[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Couleur</Label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded-lg border border-border bg-transparent" />
              </div>
            </div>
            <label className="flex items-center gap-2 pt-1"><Switch checked={isInvestment} onCheckedChange={setIsInvestment} /><span className="text-sm">Catégorie d&apos;investissement</span></label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={submit} disabled={!name || create.isPending || update.isPending}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
