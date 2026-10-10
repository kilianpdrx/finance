"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PiggyBank, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useBudgetPlan, useBudgetPlanMutations, useCategories } from "@/lib/api/hooks";
import { AMOUNT_LABEL, amountToCents, centsToAmount, monthPace, planTotals, type Envelope } from "@/lib/budget-plan";
import { formatCents, formatMonthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EnvelopeBar } from "./envelope-bar";
import { PlanEditor } from "./plan-editor";
import { UnplannedSuggestions } from "./unplanned-suggestions";

/** The plan of one account, read against the current month: a few lines to
 *  check at a glance during the month. Set once in the editor; an amount can
 *  also be changed in place, and then applies from this month on. */
export function PlanTab({ accountId, accountName }: { accountId: number; accountName: string }) {
  const { data: plan, isLoading } = useBudgetPlan(accountId);
  const { data: categories = [] } = useCategories();
  const [editing, setEditing] = useState(false);

  if (isLoading || !plan) return <Skeleton className="h-80 w-full rounded-2xl" />;

  const currency = plan.currency;
  const editor = <PlanEditor open={editing} onOpenChange={setEditing} accountId={accountId} accountName={accountName} currency={currency} plan={plan} />;

  if (!plan.exists) {
    return (
      <>
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="Pas encore de plan pour ce compte"
            description="L'application propose une première répartition à partir des 12 derniers mois de ce compte. Vous l'ajustez, puis vous l'enregistrez."
            action={<Button onClick={() => setEditing(true)}>Créer mon plan</Button>}
          />
        </Card>
        {editor}
      </>
    );
  }

  const pace = monthPace(plan.month, new Date());
  const totals = planTotals(plan.envelopes);
  const names = (ids: number[]) => ids.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="capitalize">{formatMonthLabel(plan.month, { withYear: true })}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Settings2 className="size-4" /> Modifier le plan</Button>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <ul aria-label="Enveloppes" className="divide-y divide-border">
            {plan.envelopes.map((e) => (
              <li key={e.id} className="grid grid-cols-1 items-center gap-x-5 gap-y-2 px-5 py-3 md:grid-cols-[minmax(0,1.3fr)_9.5rem_minmax(0,1.6fr)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="truncate text-xs text-muted-foreground" title={names(e.category_ids)}>
                    {e.kind === "unplanned"
                      ? "les dépenses marquées « imprévu »"
                      : `${e.category_ids.length} catégorie${e.category_ids.length > 1 ? "s" : ""}`}
                    {e.kind !== "unplanned" && e.typical_cents != null && <> · mois type <span className="nums blurable">{formatCents(e.typical_cents, currency)}</span></>}
                  </p>
                </div>
                <AmountCell envelope={e} currency={currency} />
                <div className="min-w-0">
                  <EnvelopeBar kind={e.kind} realised={e.realised_cents} target={e.target_cents} pace={pace} currency={currency} />
                  {e.kind === "unplanned" && e.ytd_provision_cents != null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Depuis janvier : <span className="nums blurable">{formatCents(e.ytd_provision_cents, currency)}</span> mis de côté,{" "}
                      <span className={cn("nums blurable", (e.ytd_realised_cents ?? 0) > e.ytd_provision_cents && "font-medium text-negative")}>
                        {formatCents(e.ytd_realised_cents ?? 0, currency)}
                      </span> d&apos;imprévus.
                    </p>
                  )}
                </div>
              </li>
            ))}

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

/** The planned amount, editable in place. Saved on Enter or on leaving the
 *  field; it then applies from the current month on (past months keep theirs). */
function AmountCell({ envelope, currency }: { envelope: Envelope; currency: string }) {
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
      {text === null ? (
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
      <p className="px-1 text-[11px] text-muted-foreground">
        {AMOUNT_LABEL[envelope.kind]} / mois
        {envelope.planned_extra_cents > 0 && <> · <span className="nums blurable" title="Dépenses planifiées ce mois-ci, ajoutées au montant">+{formatCents(envelope.planned_extra_cents, currency)} planifiés</span></>}
      </p>
    </div>
  );
}
