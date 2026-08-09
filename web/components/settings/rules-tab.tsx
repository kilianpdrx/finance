"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Merge, RefreshCw, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useAllRules, useCategories, useRuleMutations, useCategoryMutations, type CategoryRule, type Account } from "@/lib/api/hooks";
import { RuleDialog } from "@/components/settings/rule-dialog";
import { ArchivedBadge } from "@/components/transactions/category-select";

export function RulesTab({ accounts }: { accounts: Account[] }) {
  const { data: rules = [] } = useAllRules();
  const { data: categories = [] } = useCategories();
  const { update, remove, merge } = useRuleMutations();
  const { rescan } = useCategoryMutations();

  // Rules only apply on import or when re-applied — run a rescan over existing
  // (non-verified) transactions so newly-added rules take effect immediately.
  const reapplyRules = () =>
    rescan.mutate(undefined, {
      onSuccess: (r) => toast.success(`${(r as { updated: number }).updated} transaction(s) recatégorisée(s)`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`;
  const catColor = (id: number) => categories.find((c) => c.id === id)?.color ?? "var(--muted-foreground)";
  const catArchived = (id: number) => categories.find((c) => c.id === id)?.archived ?? false;

  const [search, setSearch] = useState("");
  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    const nameOf = (id: number) => (categories.find((c) => c.id === id)?.name ?? "").toLowerCase();
    return rules.filter(
      (r) =>
        nameOf(r.category_id).includes(q) ||
        r.conditions.some((c) => String(c.value).toLowerCase().includes(q) || c.field.toLowerCase().includes(q)),
    );
  }, [rules, categories, search]);
  // Group rules by their category's parent namespace (a top-level category is its
  // own group). Groups sorted alphabetically; rules within a group by category name.
  const groups = useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]));
    const nameOf = (id: number) => catById.get(id)?.name ?? "";
    const map = new Map<number, { label: string; items: CategoryRule[] }>();
    for (const r of filteredRules) {
      const cat = catById.get(r.category_id);
      const parent = cat?.parent_id != null ? catById.get(cat.parent_id) : null;
      const keyId = parent?.id ?? cat?.id ?? -1;
      const label = parent?.name ?? cat?.name ?? "Autres";
      if (!map.has(keyId)) map.set(keyId, { label, items: [] });
      map.get(keyId)!.items.push(r);
    }
    return [...map.entries()]
      .map(([key, g]) => ({
        key: String(key),
        label: g.label,
        items: g.items.sort((a, b) => nameOf(a.category_id).localeCompare(nameOf(b.category_id)) || a.id - b.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredRules, categories]);

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (r: CategoryRule) => { setEditing(r); setOpen(true); };

  const doMerge = async () => {
    try { await merge.mutateAsync({ ruleIds: [...selected], logicOperator: "OR" }); toast.success("Règles fusionnées"); setSelected(new Set()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {search.trim() ? `${filteredRules.length} / ${rules.length}` : rules.length} règles · triées par priorité. Les règles s&apos;appliquent à l&apos;import ou via « Réappliquer ».
        </p>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une règle…" className="h-9 w-52 pl-8" />
          </div>
          {selected.size >= 2 && <Button variant="outline" size="sm" onClick={doMerge}><Merge className="size-4" /> Fusionner ({selected.size})</Button>}
          <Button variant="outline" size="sm" disabled={rescan.isPending} onClick={reapplyRules}>
            <RefreshCw className={`size-4 ${rescan.isPending ? "animate-spin" : ""}`} /> Réappliquer les règles
          </Button>
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
                  {catArchived(r.category_id) && <ArchivedBadge className="shrink-0" />}
                  <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                    {r.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(` ${r.logic_operator} `)}
                  </span>
                  <Switch checked={r.is_active} onCheckedChange={(v) => update.mutate({ ruleId: r.id, body: { is_active: v } })} />
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" onClick={() => remove.mutate(r.id)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>

      <RuleDialog open={open} onOpenChange={setOpen} accounts={accounts} editing={editing} />
    </div>
  );
}
