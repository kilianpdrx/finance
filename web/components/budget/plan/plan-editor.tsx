"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchBudgetProposal, previewBudgetPlan, useBudgetPlanMutations, useCategories, type Category } from "@/lib/api/hooks";
import {
  AMOUNT_LABEL, amountToCents, centsToAmount, draftsFromPlan, draftsToPayload, eligibleCategories, fitsKind, moveCategory,
  planTotals, type BudgetPlan, type DraftEnvelope, type EnvelopeKind,
} from "@/lib/budget-plan";
import { currencySymbol, formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Stats { typical: number | null; average: number | null }

const KIND_CHOICES: { value: EnvelopeKind; label: string; hint: string }[] = [
  { value: "expense", label: "Dépenses", hint: "un plafond à ne pas dépasser" },
  { value: "income", label: "Revenus", hint: "un montant attendu" },
  { value: "goal", label: "Objectif", hint: "un minimum à atteindre (investissements)" },
];

/** The whole plan of one account, edited in one place and saved in one go.
 *
 *  An account without a plan opens on the app's proposal — a first split read
 *  from its last twelve months — which is only a starting point: nothing exists
 *  until « Enregistrer ». Each envelope shows a typical month for the categories
 *  it currently holds (recomputed when they move), so the amount is chosen
 *  knowingly rather than guessed. */
export function PlanEditor({
  open,
  onOpenChange,
  accountId,
  accountName,
  currency,
  plan,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: number;
  accountName: string;
  currency: string;
  /** The saved plan, when there is one. */
  plan: BudgetPlan | undefined;
}) {
  const { data: categories = [] } = useCategories();
  const { save } = useBudgetPlanMutations();
  const [drafts, setDrafts] = useState<DraftEnvelope[] | null>(null);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [proposed, setProposed] = useState(false);
  const nextKey = useRef(0);

  // Start from the saved plan, or from the proposal when there is none.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const start = (source: BudgetPlan, isProposal: boolean) => {
      if (cancelled) return;
      const initial = draftsFromPlan(source);
      setDrafts(initial);
      setProposed(isProposal);
      setStats(Object.fromEntries(initial.map((d, i) => [d.key, { typical: source.envelopes[i].typical_cents ?? null, average: source.envelopes[i].average_cents ?? null }])));
    };
    setDrafts(null);
    if (plan?.exists) start(plan, false);
    else fetchBudgetProposal(accountId).then((p) => start(p, true)).catch((e) => {
      if (!cancelled) { toast.error(e instanceof Error ? e.message : "Erreur"); setDrafts([]); setProposed(false); }
    });
    return () => { cancelled = true; };
    // Re-reading `plan` while the dialog is open would throw away what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accountId]);

  // A typical month depends on WHICH categories an envelope holds: ask again
  // when they move (not on every keystroke in a name or an amount).
  const membership = (drafts ?? []).map((d) => `${d.key}:${d.kind}:${[...d.categoryIds].sort().join(",")}`).join("|");
  useEffect(() => {
    if (!open || !drafts || drafts.length === 0) return;
    const current = drafts;
    const timer = setTimeout(() => {
      previewBudgetPlan(accountId, draftsToPayload(current))
        .then((p) => setStats(Object.fromEntries(current.map((d, i) => [d.key, { typical: p.envelopes[i]?.typical_cents ?? null, average: p.envelopes[i]?.average_cents ?? null }]))))
        .catch(() => { /* the figures are a help: the plan can be edited without them */ });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membership, open, accountId]);

  const eligible = useMemo(() => eligibleCategories(categories, accountId), [categories, accountId]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const assigned = new Set((drafts ?? []).flatMap((d) => d.categoryIds));
  const unassigned = eligible.filter((c) => !assigned.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));

  const patch = (key: string, change: Partial<DraftEnvelope>) =>
    setDrafts((ds) => (ds ?? []).map((d) => (d.key === key ? { ...d, ...change } : d)));
  const setKind = (d: DraftEnvelope, kind: EnvelopeKind) =>
    // The categories of the other side cannot follow: they go back to "hors enveloppes".
    patch(d.key, { kind, categoryIds: d.categoryIds.filter((id) => { const c = byId.get(id); return c ? fitsKind(c, kind) : false; }) });
  const move = (categoryId: number, toKey: string | null) => setDrafts((ds) => moveCategory(ds ?? [], categoryId, toKey));
  const add = (kind: EnvelopeKind) =>
    setDrafts((ds) => [...(ds ?? []), { key: `n${nextKey.current++}`, id: null, name: kind === "unplanned" ? "Imprévus" : "", kind, amount: "", categoryIds: [] }]);
  const remove = (key: string) => setDrafts((ds) => (ds ?? []).filter((d) => d.key !== key));
  const shift = (index: number, by: -1 | 1) =>
    setDrafts((ds) => {
      const next = [...(ds ?? [])];
      const target = index + by;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const totals = planTotals((drafts ?? []).map((d) => ({ kind: d.kind, target_cents: amountToCents(d.amount) })));
  const unnamed = (drafts ?? []).some((d) => !d.name.trim());
  const hasProvision = (drafts ?? []).some((d) => d.kind === "unplanned");

  const submit = async () => {
    if (!drafts) return;
    try {
      await save.mutateAsync({ accountId, envelopes: draftsToPayload(drafts) });
      toast.success("Plan enregistré");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const chip = (c: Category, from: DraftEnvelope | null) => (
    <DropdownMenu key={c.id}>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Déplacer cette catégorie"
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs hover:border-brand">
          <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
          <span className="truncate">{c.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Mettre « {c.name} » dans</DropdownMenuLabel>
        {(drafts ?? []).filter((d) => d.key !== from?.key && fitsKind(c, d.kind)).map((d) => (
          <DropdownMenuItem key={d.key} onSelect={() => move(c.id, d.key)}>{d.name.trim() || "Enveloppe sans nom"}</DropdownMenuItem>
        ))}
        {from && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => move(c.id, null)}>Hors enveloppes</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Plan de budget · {accountName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-1">
          {drafts === null ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {proposed && (
                <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-foreground">
                  Proposition de départ, calculée sur les 12 derniers mois de ce compte : chaque montant est un mois type.
                  Divisez « Dépenses variables » en autant d&apos;enveloppes que vous voulez, puis enregistrez. Rien n&apos;existe avant.
                </p>
              )}

              {drafts.map((d, index) => {
                const s = stats[d.key];
                const candidates = unassigned.filter((c) => fitsKind(c, d.kind));
                return (
                  <section key={d.key} aria-label={d.name.trim() || "Enveloppe sans nom"} className="space-y-2 rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input aria-label="Nom de l'enveloppe" value={d.name} placeholder="Nom de l'enveloppe"
                        onChange={(e) => patch(d.key, { name: e.target.value })} className="min-w-[10rem] flex-1" />
                      {d.kind === "unplanned" ? (
                        <span className="rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">Provision</span>
                      ) : (
                        <Select value={d.kind} onValueChange={(v) => setKind(d, v as EnvelopeKind)}>
                          <SelectTrigger aria-label="Type d'enveloppe" className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {KIND_CHOICES.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Input aria-label={`Montant mensuel (${AMOUNT_LABEL[d.kind]})`} inputMode="decimal" value={d.amount} placeholder="0"
                          onChange={(e) => patch(d.key, { amount: e.target.value })} className="nums w-28 text-right" />
                        <span className="text-xs text-muted-foreground">{currencySymbol(currency)} / mois</span>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Monter" disabled={index === 0} onClick={() => shift(index, -1)}><ArrowUp className="size-4" /></Button>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Descendre" disabled={index === drafts.length - 1} onClick={() => shift(index, 1)}><ArrowDown className="size-4" /></Button>
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" aria-label="Supprimer l'enveloppe" onClick={() => remove(d.key)}><Trash2 className="size-4" /></Button>
                      </div>
                    </div>

                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{d.kind === "unplanned" ? "Provision pour les dépenses que vous marquez « imprévu »." : KIND_CHOICES.find((k) => k.value === d.kind)?.hint}</span>
                      {d.kind !== "unplanned" && s?.typical != null && (
                        <>
                          <span>· mois type <span className="nums blurable font-medium text-foreground">{formatCents(s.typical, currency)}</span></span>
                          {s.average != null && s.average !== s.typical && <span>· moyenne <span className="nums blurable">{formatCents(s.average, currency)}</span></span>}
                          <button type="button" className="text-brand hover:underline"
                            onClick={() => patch(d.key, { amount: centsToAmount(Math.round(s.typical! / 100) * 100) })}>
                            Utiliser le mois type
                          </button>
                        </>
                      )}
                    </p>

                    {d.kind !== "unplanned" && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {d.categoryIds.map((id) => byId.get(id)).filter((c): c is Category => c !== undefined).map((c) => chip(c, d))}
                        {candidates.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-brand hover:text-foreground">
                                <Plus className="size-3" /> Catégorie
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                              {candidates.map((c) => (
                                <DropdownMenuItem key={c.id} onSelect={() => move(c.id, d.key)}>
                                  <span className="mr-2 size-2 shrink-0 rounded-full" style={{ background: c.color }} />{c.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        {d.categoryIds.length === 0 && candidates.length === 0 && <span className="text-xs text-muted-foreground">Aucune catégorie disponible pour ce type.</span>}
                      </div>
                    )}
                  </section>
                );
              })}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => add("expense")}><Plus className="size-4" /> Enveloppe de dépenses</Button>
                <Button variant="outline" size="sm" onClick={() => add("income")}><Plus className="size-4" /> Revenus</Button>
                <Button variant="outline" size="sm" onClick={() => add("goal")}><Plus className="size-4" /> Objectif</Button>
                {!hasProvision && <Button variant="outline" size="sm" onClick={() => add("unplanned")}><Plus className="size-4" /> Provision pour imprévus</Button>}
              </div>

              <section aria-label="Hors enveloppes" className="space-y-2 rounded-xl bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Hors enveloppes · {unassigned.length}</span> — ce que vous laissez ici reste
                  visible dans le plan, sans montant prévu. Cliquez une catégorie pour la ranger.
                </p>
                <div className="flex flex-wrap gap-1.5">{unassigned.map((c) => chip(c, null))}</div>
              </section>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0 items-center gap-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">
            <span className="nums blurable">{formatCents(totals.income, currency)}</span> de revenus − <span className="nums blurable">{formatCents(totals.ceilings + totals.goals + totals.provision, currency)}</span> prévus ={" "}
            <span className={cn("nums blurable font-semibold", totals.unassigned < 0 ? "text-negative" : "text-foreground")}>{formatCents(totals.unassigned, currency, { sign: true })}</span> non affectés
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button onClick={submit} disabled={save.isPending || drafts === null || unnamed} title={unnamed ? "Chaque enveloppe doit avoir un nom" : undefined}>
              {save.isPending ? "…" : "Enregistrer"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
