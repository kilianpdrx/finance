"use client";

import { useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCategories, useTransactionMutations, useUnplannedSuggestions } from "@/lib/api/hooks";
import type { UnplannedSuggestion } from "@/lib/budget-plan";
import { formatCents } from "@/lib/format";

const RECENT = 2;      // this month and the one before
const WHOLE_YEAR = 13;

/** Large expenses whose label does not come back: « imprévu ? ». The app only
 *  asks — marking one moves it out of its envelope and against the provision,
 *  "c'est normal" keeps it where it is; either way it is not asked again. */
export function UnplannedSuggestions({ accountId, currency }: { accountId: number; currency: string }) {
  const [months, setMonths] = useState(RECENT);
  const { data: suggestions = [], isLoading } = useUnplannedSuggestions(accountId, months);
  const { data: categories = [] } = useCategories();
  const { update } = useTransactionMutations();
  const catName = (id: number | null | undefined) => categories.find((c) => c.id === id)?.name ?? "Sans catégorie";

  const answer = (s: UnplannedSuggestion, unplanned: boolean) =>
    update.mutate({ id: s.id, body: { is_unplanned: unplanned } }, {
      onSuccess: () => toast.success(unplanned ? "Marquée comme imprévue : elle sort de son enveloppe" : "Notée comme normale"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });

  const switchRange = (
    <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      onClick={() => setMonths(months === RECENT ? WHOLE_YEAR : RECENT)}>
      {months === RECENT ? "Revoir les 12 derniers mois" : "Seulement ce mois-ci et le précédent"}
    </button>
  );

  if (isLoading) return null;
  if (suggestions.length === 0) {
    // Nothing to ask about lately: stay out of the way, but keep the way back.
    return <p className="px-1 text-xs text-muted-foreground">Aucune dépense inhabituelle {months === RECENT ? "ces deux derniers mois" : "sur 12 mois"}. {switchRange}</p>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>Dépenses inhabituelles · {suggestions.length}</CardTitle>
          <CardDescription>
            De grosses dépenses dont le libellé ne revient pas. « Imprévu » : elle sort de son enveloppe et compte dans la
            provision. « C&apos;est normal » : elle reste où elle est.
          </CardDescription>
        </div>
        <div className="shrink-0 pt-1">{switchRange}</div>
      </CardHeader>
      <CardContent className="px-0 pb-1">
        <ul aria-label="Dépenses inhabituelles" className="divide-y divide-border">
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
              <span className="nums w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">{format(new Date(s.date), "dd MMM yy", { locale: fr })}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={s.description}>{s.description}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {catName(s.category_id)}{s.envelope_name ? ` · enveloppe ${s.envelope_name}` : " · hors enveloppes"}
                  {s.typical_cents > 0 && <> · mois type de la catégorie : <span className="nums blurable">{formatCents(s.typical_cents, currency)}</span></>}
                </span>
              </span>
              <span className="nums blurable shrink-0 font-semibold text-negative">−{formatCents(s.amount_cents, currency)}</span>
              <span className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => answer(s, true)}>Imprévu</Button>
                <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => answer(s, false)}>C&apos;est normal</Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
