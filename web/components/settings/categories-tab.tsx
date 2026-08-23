"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Sparkles, CornerDownRight, ChevronRight, Archive, ArchiveRestore, Replace } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAccounts, useCategories, useCategoryMutations, useArchiveSuggestions, type Category } from "@/lib/api/hooks";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AccountSelect, GLOBAL_ACCOUNT } from "@/components/accounts/account-select";
import { ArchivedBadge } from "@/components/transactions/category-select";
import { groupByAccount, orderCategoryTree } from "@/lib/group";

type TypeKey = "income" | "fixed" | "variable";
const TYPE_LABEL: Record<TypeKey, string> = { income: "Revenu", fixed: "Dépense fixe", variable: "Dépense variable" };
const NO_PARENT = "__none__";

function typeOf(c: Category): TypeKey {
  if (c.is_income) return "income";
  return c.expense_type === "fixed" ? "fixed" : "variable";
}

export function CategoriesTab() {
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: suggestions = [] } = useArchiveSuggestions();
  const { create, update, remove, rescan, seedDefaults } = useCategoryMutations();
  const confirm = useConfirm();
  const active = useMemo(() => categories.filter((c) => !c.archived), [categories]);
  const archived = useMemo(() => categories.filter((c) => c.archived), [categories]);
  const groups = useMemo(() => groupByAccount(active, accounts), [active, accounts]);
  const suggestBy = useMemo(() => new Map(suggestions.map((s) => [s.category_id, s])), [suggestions]);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [seed, setSeed] = useState<{ parentId: number | null; accountId: number | null; type?: TypeKey; color?: string } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#10b981");
  const [type, setType] = useState<TypeKey>("variable");
  const [isInvestment, setIsInvestment] = useState(false);
  const [parentId, setParentId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);

  // Collapsed parent namespaces (by parent category id) — hides their children.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const toggleCollapsed = (id: number) =>
    setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const parentIdSet = useMemo(() => new Set(categories.filter((c) => c.parent_id != null).map((c) => c.parent_id)), [categories]);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setColor(editing?.color ?? seed?.color ?? "#10b981");
      setType(editing ? typeOf(editing) : seed?.type ?? "variable");
      setIsInvestment(editing?.is_investment ?? false);
      setParentId(editing?.parent_id ?? seed?.parentId ?? null);
      setAccountId(editing?.account_id ?? seed?.accountId ?? null);
    }
  }, [open, editing, seed]);

  const openNew = () => { setSeed(null); setEditing(null); setOpen(true); };
  const openEdit = (c: Category) => { setSeed(null); setEditing(c); setOpen(true); };
  const openAddSub = (parent: Category) => { setSeed({ parentId: parent.id, accountId: parent.account_id ?? null }); setEditing(null); setOpen(true); };

  const onArchive = (c: Category) =>
    update.mutate({ id: c.id, body: { archived: true } }, { onSuccess: () => toast.success(`« ${c.name} » archivée`) });
  const onUnarchive = (c: Category) =>
    update.mutate({ id: c.id, body: { archived: false } }, {
      onSuccess: () => toast.success(`« ${c.name} » désarchivée`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  const onDismissSuggestion = (c: Category) => update.mutate({ id: c.id, body: { archive_dismissed: true } });
  const onArchiveReplace = (c: Category) => {
    update.mutate({ id: c.id, body: { archived: true } }, {
      onSuccess: () => {
        toast.success(`« ${c.name} » archivée — créez sa remplaçante`);
        setSeed({ parentId: c.parent_id ?? null, accountId: c.account_id ?? null, type: typeOf(c), color: c.color });
        setEditing(null);
        setOpen(true);
      },
    });
  };

  // A category that has children can't itself become a subcategory (single level).
  const editingHasChildren = editing ? categories.some((c) => c.parent_id === editing.id) : false;
  // Valid parents: top-level categories in the chosen account scope, excluding self.
  const parentOptions = categories.filter(
    (c) => c.parent_id == null && !c.archived && c.id !== editing?.id && (c.account_id ?? null) === accountId,
  );

  const submit = async () => {
    const body = {
      name, color, icon: editing?.icon ?? "tag",
      is_income: type === "income",
      expense_type: type === "income" ? null : type,
      is_investment: isInvestment,
      account_id: accountId,
      parent_id: editingHasChildren ? null : parentId,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      toast.success(editing ? "Catégorie mise à jour" : "Catégorie créée");
      setOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const onDelete = async (c: Category) => {
    const kids = categories.filter((x) => x.parent_id === c.id).length;
    const ok = await confirm({
      title: `Supprimer « ${c.name} » ?`,
      description: kids > 0
        ? `Ses ${kids} sous-catégorie(s) deviendront des catégories principales, et ses transactions seront reclassées comme « Sans catégorie ».`
        : "Les transactions de cette catégorie seront reclassées comme « Sans catégorie ».",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (ok) remove.mutate({ id: c.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{active.length} catégories{archived.length > 0 ? ` · ${archived.length} archivée(s)` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {categories.length === 0 && (
            <Button variant="outline" size="sm" disabled={seedDefaults.isPending}
              onClick={() => seedDefaults.mutate(undefined, { onSuccess: (r) => toast.success(`${(r as { created: number }).created} catégorie(s) standard créée(s)`) })}>
              <Sparkles className="size-4" /> Créer les catégories standard
            </Button>
          )}
          {categories.length > 0 && (
            <Button variant="outline" size="sm" disabled={seedDefaults.isPending}
              onClick={() => seedDefaults.mutate(undefined, { onSuccess: (r) => toast.success(`${(r as { created: number }).created} catégorie(s) standard ajoutée(s)`) })}>
              <Sparkles className="size-4" /> Catégories standard
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => rescan.mutate(undefined, { onSuccess: (r) => toast.success(`${(r as { updated: number }).updated} transactions recatégorisées`) })} disabled={rescan.isPending}>
            <RefreshCw className={`size-4 ${rescan.isPending ? "animate-spin" : ""}`} /> Rescanner
          </Button>
          <Button size="sm" onClick={openNew}><Plus className="size-4" /> Catégorie</Button>
        </div>
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.key} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label} · {g.items.length}</h3>
            <Card className="divide-y divide-border p-0">
              {orderCategoryTree(g.items).map(({ cat: c, child }) => {
                if (child && c.parent_id != null && collapsed.has(c.parent_id)) return null;
                const isParent = parentIdSet.has(c.id);
                const isCollapsed = collapsed.has(c.id);
                return (
                  <div key={c.id} className={`flex items-center gap-3 px-4 py-2.5 ${child ? "pl-10" : ""}`}>
                    {child ? (
                      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                    ) : isParent ? (
                      <button onClick={() => toggleCollapsed(c.id)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={isCollapsed ? "Développer" : "Réduire"}>
                        <ChevronRight className={`size-3.5 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                      </button>
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 truncate font-medium">{c.name}</span>
                    {c.is_investment && <Badge variant="brand">Invest.</Badge>}
                    <Badge variant={c.is_income ? "positive" : "neutral"}>{TYPE_LABEL[typeOf(c)]}</Badge>
                    {suggestBy.has(c.id) && (
                      <span className="inline-flex items-center gap-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                        {suggestBy.get(c.id)!.months_inactive != null ? `inactive ${suggestBy.get(c.id)!.months_inactive} mois` : "jamais utilisée"}
                        <button className="font-semibold underline underline-offset-2" onClick={() => onArchive(c)}>archiver</button>
                        <button className="opacity-70 hover:opacity-100" title="Garder (ne plus suggérer)" onClick={() => onDismissSuggestion(c)}>✕</button>
                      </span>
                    )}
                    {!child && (
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-brand" title="Ajouter une sous-catégorie" aria-label="Ajouter une sous-catégorie" onClick={() => openAddSub(c)}><Plus className="size-4" /></Button>
                    )}
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="Archiver" aria-label="Archiver la catégorie" onClick={() => onArchive(c)}><Archive className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" title="Archiver et remplacer" aria-label="Archiver et remplacer la catégorie" onClick={() => onArchiveReplace(c)}><Replace className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Modifier la catégorie" onClick={() => openEdit(c)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" aria-label="Supprimer la catégorie" onClick={() => onDelete(c)}><Trash2 className="size-4" /></Button>
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setShowArchived((v) => !v)} className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
            <ChevronRight className={`size-3.5 transition-transform ${showArchived ? "rotate-90" : ""}`} />
            <Archive className="size-3.5" /> Archivées · {archived.length}
          </button>
          {showArchived && (
            <Card className="divide-y divide-border p-0">
              {archived.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 opacity-70">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 truncate font-medium">{c.name}</span>
                  <ArchivedBadge />
                  <Badge variant={c.is_income ? "positive" : "neutral"}>{TYPE_LABEL[typeOf(c)]}</Badge>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-brand" title="Désarchiver" onClick={() => onUnarchive(c)}><ArchiveRestore className="size-4" /></Button>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" onClick={() => onDelete(c)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifier la catégorie" : seed?.parentId != null ? "Nouvelle sous-catégorie" : "Nouvelle catégorie"}</DialogTitle></DialogHeader>
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
            <div className="space-y-1">
              <Label>Compte</Label>
              <AccountSelect
                accounts={accounts}
                includeGlobal
                value={accountId == null ? GLOBAL_ACCOUNT : String(accountId)}
                onChange={(v) => { setAccountId(v === GLOBAL_ACCOUNT ? null : Number(v)); setParentId(null); }}
              />
            </div>
            <div className="space-y-1">
              <Label>Catégorie parente</Label>
              <Select value={parentId == null ? NO_PARENT : String(parentId)} disabled={editingHasChildren}
                onValueChange={(v) => setParentId(v === NO_PARENT ? null : Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>Aucune (catégorie principale)</SelectItem>
                  {parentOptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: p.color }} /> {p.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingHasChildren && <p className="text-xs text-muted-foreground">Cette catégorie a des sous-catégories.</p>}
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
