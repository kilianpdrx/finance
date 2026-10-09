"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Merge, RefreshCw, Search, ChevronDown, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useAllRules, useCategories, useRuleMutations, useCategoryMutations, previewRescan, type CategoryRule, type Account, type RescanResult } from "@/lib/api/hooks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { RuleDialog } from "@/components/settings/rule-dialog";
import { RuleTester } from "@/components/settings/rule-tester";
import { ArchivedBadge } from "@/components/transactions/category-select";
import { amountConditionIssue, ruleSummary } from "@/lib/rules";

export function RulesTab({ accounts }: { accounts: Account[] }) {
  const { data: rules = [] } = useAllRules();
  const { data: categories = [] } = useCategories();
  const { update, remove, merge } = useRuleMutations();
  const { rescan } = useCategoryMutations();

  const confirm = useConfirm();
  const router = useRouter();
  // Rules only apply on import or when re-applied. Whatever the scope, a category
  // the user chose is never touched: "sans catégorie" fills the empty rows, "à
  // toutes" also brings the rows a RULE classified in line with today's rules.
  // Hand-labelled and « vérifié » rows are left alone — where the rules disagree
  // with a hand label, the row is only flagged (« ≠ règle »).
  const tellDisagreements = (n: number) => {
    if (n === 0) return;
    toast.info(`${n} transaction(s) classée(s) à la main contredisent une règle`, {
      description: "Elles gardent votre catégorie et portent le badge « ≠ règle ».",
      duration: 12000,
      action: { label: "Voir", onClick: () => router.push("/transactions?classement=desaccord") },
    });
  };
  const reapply = (scope: "uncategorized" | "all") =>
    rescan.mutate(scope, {
      onSuccess: (r) => {
        const res = r as RescanResult;
        toast.success(`${res.updated} transaction(s) recatégorisée(s)`);
        tellDisagreements(res.manual_disagreements);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  // Says what WOULD change before changing it: the counts come from a dry run.
  const reapplyAll = async () => {
    let preview: RescanResult;
    try { preview = await previewRescan("all"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); return; }
    if (preview.updated === 0) {
      toast.info("Rien à changer : vos transactions suivent déjà vos règles.");
      tellDisagreements(preview.manual_disagreements);
      return;
    }
    const ok = await confirm({
      title: "Réappliquer les règles à toutes les transactions ?",
      description: (
        <>
          <span className="block">
            {preview.updated} transaction(s) classée(s) par une règle, ou sans catégorie, changeraient de catégorie
            {preview.cleared > 0 && <>, dont {preview.cleared} n&apos;en auraient plus : aucune règle ne leur correspond désormais</>}.
          </span>
          <span className="mt-2 block">
            Celles que vous avez classées à la main et celles marquées « vérifié » ne sont jamais modifiées.
          </span>
          {preview.manual_disagreements > 0 && (
            <span className="mt-2 block">
              {preview.manual_disagreements} transaction(s) classée(s) à la main contredisent une règle : elles gardent
              votre catégorie et portent le badge « ≠ règle ».
            </span>
          )}
          {preview.conflicts > 0 && (
            <span className="mt-2 block">{preview.conflicts} autre(s) correspondent à des règles qui se contredisent et restent telles quelles.</span>
          )}
        </>
      ),
      confirmLabel: "Réappliquer",
      destructive: preview.cleared > 0,
    });
    if (ok) reapply("all");
  };

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
          {search.trim() ? `${filteredRules.length} / ${rules.length}` : rules.length} règles, sans priorité entre elles : si deux règles désignent des catégories différentes, la transaction reste sans catégorie. Elles s&apos;appliquent à l&apos;import ou via « Réappliquer ».
        </p>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une règle…" className="h-9 w-52 pl-8" />
          </div>
          {selected.size >= 2 && <Button variant="outline" size="sm" onClick={doMerge}><Merge className="size-4" /> Fusionner ({selected.size})</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={rescan.isPending}>
                <RefreshCw className={`size-4 ${rescan.isPending ? "animate-spin" : ""}`} /> Réappliquer les règles <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem onSelect={() => reapply("uncategorized")}>
                <div>
                  <p className="text-sm">Aux transactions sans catégorie</p>
                  <p className="text-xs text-muted-foreground">Ne touche pas l&apos;historique déjà classé.</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={reapplyAll}>
                <div>
                  <p className="text-sm">À toutes les transactions…</p>
                  <p className="text-xs text-muted-foreground">Sauf celles classées à la main ou vérifiées.</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" onClick={openCreate}><Plus className="size-4" /> Règle</Button>
        </div>
      </div>

      <RuleTester onEditRule={(id) => { const r = rules.find((x) => x.id === id); if (r) openEdit(r); }} />

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} · {g.items.length}</h3>
            <Card className="divide-y divide-border p-0">
              {g.items.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Checkbox checked={selected.has(r.id)} onCheckedChange={() => setSelected((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: catColor(r.category_id) }} />
                  <span className="w-40 shrink-0 truncate text-sm font-medium">{catName(r.category_id)}</span>
                  {catArchived(r.category_id) && <ArchivedBadge className="shrink-0" />}
                  <span className="flex-1 truncate text-xs text-muted-foreground" title={ruleSummary(r)}>
                    {ruleSummary(r)}
                  </span>
                  {/* An amount has no sign in a rule: "> 0" filters nothing. Point
                      at the rules written that way; the editor offers the fix. */}
                  {r.conditions.some((c) => amountConditionIssue(c)) && (
                    <button type="button" onClick={() => openEdit(r)}
                      className="inline-flex shrink-0 items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/25"
                      title="Une condition sur le montant ne filtre rien : un montant se compare sans son signe. Ouvrez la règle pour la corriger.">
                      <AlertTriangle className="size-3" /> condition sans effet
                    </button>
                  )}
                  <Switch checked={r.is_active} onCheckedChange={(v) => update.mutate({ ruleId: r.id, body: { is_active: v } })} />
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Modifier la règle" onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" aria-label="Supprimer la règle" onClick={() => remove.mutate(r.id)}><Trash2 className="size-4" /></Button>
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
