"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, PiggyBank, Settings2, StickyNote, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useBudgetPlan, useBudgetPlanMutations, useCategories, usePlannedExpenseMutations, type Category } from "@/lib/api/hooks";
import { AMOUNT_LABEL, DONE_LABEL, amountToCents, centsToAmount, monthPace, planTotals, type Envelope } from "@/lib/budget-plan";
import { formatCents, formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EnvelopeBar } from "./envelope-bar";
import { PlanEditor, type PlanEditorView } from "./plan-editor";
import { UnplannedSuggestions } from "./unplanned-suggestions";

const ROW = "grid grid-cols-1 items-center gap-x-5 gap-y-2 md:grid-cols-[minmax(0,1.3fr)_13rem_minmax(0,1.6fr)]";

/** The plan of one account, read against the current month: a few lines to
 *  check at a glance during the month, each of which unfolds into its
 *  categories. Set once in the editor; an amount can also be changed in place,
 *  and then applies from this month on. */
export function PlanTab({ accountId, accountName }: { accountId: number; accountName: string }) {
  const { data: plan, isLoading } = useBudgetPlan(accountId);
  const { data: categories = [] } = useCategories();
  // The editor, and the view it opens on (null: closed).
  const [editing, setEditing] = useState<PlanEditorView | null>(null);
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());

  if (isLoading || !plan) return <Skeleton className="h-80 w-full rounded-2xl" />;

  const currency = plan.currency;
  const editor = (
    <PlanEditor open={editing !== null} onOpenChange={(v) => { if (!v) setEditing(null); }} initialView={editing ?? "envelopes"}
      accountId={accountId} accountName={accountName} currency={currency} plan={plan} />
  );

  if (!plan.exists) {
    return (
      <>
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="Pas encore de plan pour ce compte"
            description="L'application propose une première répartition à partir des 12 derniers mois de ce compte. Vous l'ajustez, puis vous l'enregistrez."
            action={<Button onClick={() => setEditing("envelopes")}>Créer mon plan</Button>}
          />
        </Card>
        {editor}
      </>
    );
  }

  const pace = monthPace(plan.month, new Date());
  const totals = planTotals(plan.envelopes);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names = (ids: number[]) => ids.map((id) => byId.get(id)?.name).filter(Boolean).join(", ");
  const toggle = (id: number) => setUnfolded((open) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const hasProvision = plan.envelopes.some((e) => e.kind === "unplanned");
  const tiles: { label: string; value: number; tone?: string; signed?: boolean }[] = [
    { label: "Revenus attendus", value: totals.income },
    { label: "Dépenses plafonnées", value: totals.ceilings },
    ...(totals.goals > 0 ? [{ label: "À investir au moins", value: totals.goals }] : []),
    ...(totals.provision > 0 ? [{ label: "Provision imprévus", value: totals.provision }] : []),
    { label: "Non affecté", value: totals.unassigned, tone: totals.unassigned < 0 ? "text-negative" : "text-positive", signed: true },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-muted/50 px-4 py-3">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className={cn("nums blurable text-lg font-semibold", t.tone)}>{formatCents(t.value, currency, { sign: t.signed })}</p>
          </div>
        ))}
      </div>
      {totals.unassigned < 0 && (
        <p className="text-xs text-negative">Ce plan prévoit de dépenser plus qu&apos;il ne rentre.</p>
      )}

      {plan.note && (
        <button type="button" onClick={() => setEditing("envelopes")} title="Modifier dans le plan"
          className="flex w-full items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-4 py-3 text-left text-sm hover:border-brand">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="whitespace-pre-wrap">{plan.note}</span>
        </button>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="capitalize">{formatMonthLabel(plan.month, { withYear: true })}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditing("envelopes")}><Settings2 className="size-4" /> Modifier le plan</Button>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <ul aria-label="Enveloppes" className="divide-y divide-border">
            {plan.envelopes.map((e) => {
              const open = e.id != null && unfolded.has(e.id);
              const foldable = e.id != null && (e.categories.length > 0 || e.lines.length > 0 || !!e.note);
              return (
                <li key={e.id}>
                  <div className={cn(ROW, "px-5 py-3")}>
                    <div className="flex min-w-0 items-start gap-1.5">
                      {foldable ? (
                        <button type="button" aria-expanded={open} aria-label={`Détail de ${e.name}`} onClick={() => toggle(e.id!)}
                          className="-ml-1 mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
                        </button>
                      ) : <span className="w-4 shrink-0" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        <p className="truncate text-xs text-muted-foreground" title={names(e.category_ids)}>
                          {e.kind === "unplanned"
                            ? "les dépenses marquées « imprévu »"
                            : `${e.category_ids.length} catégorie${e.category_ids.length > 1 ? "s" : ""}`}
                          {e.kind !== "unplanned" && e.typical_cents != null && <> · mois type <span className="nums blurable">{formatCents(e.typical_cents, currency)}</span></>}
                        </p>
                        {e.note && !open && (
                          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" title={e.note}>
                            <StickyNote className="size-3 shrink-0" /><span className="truncate">{e.note}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    <AmountCell envelope={e} currency={currency} month={plan.month} byId={byId} onOpenDetail={() => setEditing("sheet")} />
                    <div className="min-w-0">
                      <EnvelopeBar kind={e.kind} realised={e.realised_cents} target={e.amount_cents} pace={pace} currency={currency} />
                      {e.kind === "unplanned" && e.ytd_provision_cents != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Depuis janvier : <span className="nums blurable">{formatCents(e.ytd_provision_cents, currency)}</span> mis de côté,{" "}
                          <span className={cn("nums blurable", (e.ytd_realised_cents ?? 0) > e.ytd_provision_cents && "font-medium text-negative")}>
                            {formatCents(e.ytd_realised_cents ?? 0, currency)}
                          </span> d&apos;imprévus.
                        </p>
                      )}
                    </div>
                  </div>
                  {open && <CategoryLines envelope={e} byId={byId} pace={pace} currency={currency} />}
                </li>
              );
            })}

            {!hasProvision && plan.unplanned_cents > 0 && (
              <li className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                <span>Imprévus <span className="text-xs text-muted-foreground">· sans provision</span></span>
                <span className="nums blurable text-muted-foreground">{formatCents(plan.unplanned_cents, currency)} ce mois-ci</span>
              </li>
            )}

            {(plan.outside_spent_cents > 0 || plan.outside_received_cents > 0) && (
              <li className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm text-muted-foreground">
                <span title={names(plan.outside_category_ids)}>
                  Hors enveloppes
                  <span className="text-xs"> · ce qu&apos;aucune enveloppe ne couvre{plan.outside_category_ids.length > 0 && ` (${names(plan.outside_category_ids)})`}</span>
                </span>
                <span className="nums blurable">
                  {plan.outside_spent_cents > 0 && <>{formatCents(plan.outside_spent_cents, currency)} dépensés</>}
                  {plan.outside_spent_cents > 0 && plan.outside_received_cents > 0 && " · "}
                  {plan.outside_received_cents > 0 && <>{formatCents(plan.outside_received_cents, currency)} reçus</>}
                </span>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      <UnplannedSuggestions accountId={accountId} currency={currency} />
      {editor}
    </div>
  );
}

/** An envelope, category by category: what each one did this month, against
 *  its own amount when the envelope is planned line by line, against its
 *  typical month otherwise. Then its sub-lines — planned only: no category says
 *  what went into them — and its note in full. */
function CategoryLines({ envelope, byId, pace, currency }: { envelope: Envelope; byId: Map<number, Category>; pace: number; currency: string }) {
  const lines = [...envelope.categories].sort((a, b) => (byId.get(a.category_id)?.name ?? "").localeCompare(byId.get(b.category_id)?.name ?? ""));
  return (
    <div className="space-y-2 border-t border-border/60 bg-muted/30 px-5 py-3">
    {envelope.note && (
      <p className="flex items-start gap-1.5 pl-5 text-xs text-muted-foreground">
        <StickyNote className="mt-0.5 size-3 shrink-0" /><span className="whitespace-pre-wrap">{envelope.note}</span>
      </p>
    )}
    <ul aria-label={`Catégories de ${envelope.name}`} className="space-y-2">
      {lines.map((line) => {
        const category = byId.get(line.category_id);
        return (
          <li key={line.category_id} className={cn(ROW, "text-sm")}>
            <p className="flex min-w-0 items-center gap-2 pl-5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: category?.color }} />
              <span className="truncate">{category?.name ?? "Catégorie"}</span>
            </p>
            <p className="nums blurable px-1 text-left text-sm md:text-right">
              {line.amount_cents != null ? formatCents(line.amount_cents, currency) : <span className="text-muted-foreground">—</span>}
              {line.planned_cents > 0 && (
                <span className="block whitespace-nowrap text-[11px] text-muted-foreground">{formatCents(line.planned_cents, currency)} planifiés ce mois-ci</span>
              )}
            </p>
            {line.amount_cents != null ? (
              <EnvelopeBar compact kind={envelope.kind} realised={line.realised_cents} target={line.amount_cents} pace={pace} currency={currency} />
            ) : (
              <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="nums blurable">{formatCents(line.realised_cents, currency)} {DONE_LABEL[envelope.kind]}</span>
                {line.typical_cents != null && <span className="nums blurable shrink-0">mois type {formatCents(line.typical_cents, currency)}</span>}
              </p>
            )}
          </li>
        );
      })}
      {envelope.lines.map((line) => (
        <li key={line.id ?? line.name} className={cn(ROW, "text-sm")}>
          <p className="flex min-w-0 items-center gap-2 pl-5">
            <span className="size-2 shrink-0 rounded-full border border-muted-foreground" aria-hidden />
            <span className="truncate">{line.name}</span>
          </p>
          <p className="nums blurable px-1 text-left text-sm md:text-right">{formatCents(line.amount_cents, currency)}</p>
          <p className="text-xs text-muted-foreground">prévu, non suivi par catégorie</p>
        </li>
      ))}
    </ul>
    </div>
  );
}

/** The planned amount. One figure: editable in place, saved on Enter or on
 *  leaving the field; it then applies from the current month on (past months
 *  keep theirs). The sum of per-category lines: changed in the editor's sheet. */
function AmountCell({ envelope, currency, month, byId, onOpenDetail }: {
  envelope: Envelope; currency: string; month: string; byId: Map<number, Category>; onOpenDetail: () => void;
}) {
  const { setAmount } = useBudgetPlanMutations();
  const [text, setText] = useState<string | null>(null);   // null = not being edited

  const commit = () => {
    if (text === null) return;
    const cents = amountToCents(text);
    setText(null);
    if (envelope.id == null || cents === envelope.amount_cents) return;
    setAmount.mutate({ envelopeId: envelope.id, amountCents: cents }, {
      onSuccess: () => toast.success(`${envelope.name} : ${formatCents(cents, currency)} par mois, à partir de ce mois-ci`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });
  };

  return (
    <div className="text-left md:text-right">
      {envelope.detailed ? (
        <button type="button" title="La somme de ses lignes — modifier le détail" onClick={onOpenDetail}
          className="nums blurable rounded px-1 text-sm font-semibold hover:bg-muted">
          {formatCents(envelope.amount_cents, currency)}
        </button>
      ) : text === null ? (
        <button type="button" title="Changer le montant (à partir de ce mois-ci)" onClick={() => setText(centsToAmount(envelope.amount_cents))}
          className="nums blurable rounded px-1 text-sm font-semibold hover:bg-muted">
          {formatCents(envelope.amount_cents, currency)}
        </button>
      ) : (
        <Input autoFocus inputMode="decimal" aria-label={`Montant mensuel de ${envelope.name}`} value={text}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setText(null); }}
          className="nums ml-auto h-8 w-28 text-right" />
      )}
      <p className="whitespace-nowrap px-1 text-[11px] text-muted-foreground">
        {AMOUNT_LABEL[envelope.kind]} / mois{envelope.detailed && " · détaillé"}
      </p>
      {envelope.planned_cents > 0 && (
        <p className="whitespace-nowrap px-1 text-[11px] text-muted-foreground"><PlannedEntries envelope={envelope} currency={currency} month={month} byId={byId} /></p>
      )}
    </div>
  );
}

/** « 310 € planifiés ce mois-ci », and where it comes from: the « Planifier »
 *  entries of the month in this envelope's categories. A NOTE — it is in no
 *  amount and no total of the plan (see `Envelope.planned` in the API). Listed
 *  because nothing else shows them all: the budget table hides one once it is
 *  confirmed. Each can be withdrawn here. */
function PlannedEntries({ envelope, currency, month, byId }: { envelope: Envelope; currency: string; month: string; byId: Map<number, Category> }) {
  const { remove } = usePlannedExpenseMutations();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="nums blurable underline decoration-dotted underline-offset-2 hover:text-foreground">
          {formatCents(envelope.planned_cents, currency)} planifiés ce mois-ci
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 text-left">
        <p className="text-sm font-semibold text-foreground">Planifié pour {formatMonthLabel(month, { withYear: true })}</p>
        <p className="text-xs text-muted-foreground">
          Saisi avec « Planifier » dans le tableau du budget, pour ce mois-ci et sur ce compte. C&apos;est un rappel :
          il ne change ni le montant de l&apos;enveloppe, ni les totaux du plan.
        </p>
        <ul aria-label="Dépenses planifiées" className="space-y-1.5">
          {envelope.planned.map((entry) => {
            const category = byId.get(entry.category_id);
            return (
              <li key={entry.id} className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ background: category?.color }} />
                <span className="min-w-0 flex-1 truncate">{category?.name ?? "Catégorie"}</span>
                <span className="nums blurable shrink-0 font-medium">{formatCents(entry.amount_cents, currency)}</span>
                <Button variant="ghost" size="icon" className="size-6 shrink-0 text-muted-foreground hover:text-negative"
                  aria-label={`Retirer la dépense planifiée de ${category?.name ?? "cette catégorie"}`} disabled={remove.isPending}
                  onClick={() => remove.mutate(entry.id, {
                    onSuccess: () => toast.success("Dépense planifiée retirée"),
                    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
                  })}>
                  <X className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground">Retirer une ligne la supprime aussi du tableau du budget.</p>
      </PopoverContent>
    </Popover>
  );
}
