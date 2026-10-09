"use client";

import { useState } from "react";
import { Inbox, Wand2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useRecurring, useRecurringUncovered, type Category, type RecurringTransaction } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

/** The « Récurrents » and « Sans règle » tabs of the Transactions page.
 *
 *  Both list transactions grouped by label, one direction at a time (expenses or
 *  income — a purchase and its refund share a label and must not be averaged
 *  together). "uncovered" keeps only the groups no rule classifies: the natural
 *  place to write a rule from.
 *
 *  "Règle" prefills `rule_pattern` — a fragment found in every real label of the
 *  group — never the cleaned-up keyword shown as description, which often
 *  appears in no transaction at all. */
export function RecurringPanel({
  kind,
  accountId,
  categories,
  onCreateRule,
}: {
  kind: "recurring" | "uncovered";
  /** One account, or null for all of them. */
  accountId: number | null;
  categories: Category[];
  onCreateRule: (prefill: { description: string; categoryId: number | null }) => void;
}) {
  const [income, setIncome] = useState(false);
  const accountIds = accountId == null ? undefined : String(accountId);
  // Only the list being shown is fetched: each one scans every transaction.
  const recurring = useRecurring(accountIds, income, kind === "recurring");
  const uncovered = useRecurringUncovered(accountIds, income, kind === "uncovered");
  const { data, isLoading } = kind === "recurring" ? recurring : uncovered;
  const rows = (data ?? []) as RecurringTransaction[];
  const catName = (id: number | null) => categories.find((c) => c.id === id)?.name ?? "—";

  const what = income ? "revenus récurrents" : "dépenses récurrentes";
  const intro = kind === "recurring"
    ? `Les ${what} : les libellés qui reviennent, avec leur fréquence et leur montant moyen.`
    : `Les ${what} qu'aucune règle automatique ne couvre — créez une règle pour les classer, maintenant et à l'avenir.`;
  const empty = kind === "recurring"
    ? (income ? "Aucun revenu récurrent détecté" : "Aucune dépense récurrente détectée")
    : (income ? "Tous les revenus récurrents sont couverts par une règle 🎉" : "Toutes les dépenses récurrentes sont couvertes par une règle 🎉");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{intro}</p>
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {([[false, "Dépenses"], [true, "Revenus"]] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={income === value}
              onClick={() => setIncome(value)}
              className={`rounded-md px-3 py-1 font-medium transition-colors ${
                income === value
                  ? value ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-brand/15 text-brand"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Card className="p-4"><Skeleton className="h-64 w-full" /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={Inbox} title={empty} /></Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Description</TableHead>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Occurrences</TableHead>
                <TableHead className="text-right">Montant moyen</TableHead>
                <TableHead className="text-right">Dernière</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.description}|${r.currency}`} className="group">
                  <TableCell className="max-w-xs"><span className="line-clamp-1 font-medium">{r.description}</span></TableCell>
                  <TableCell className="text-muted-foreground">{catName(r.category_id)}</TableCell>
                  <TableCell className="nums text-right">{r.occurrences}×</TableCell>
                  <TableCell className="nums blurable text-right font-semibold">{formatCents(r.avg_amount_cents, r.currency)}</TableCell>
                  <TableCell className="nums text-right text-muted-foreground">{format(new Date(r.last_date), "dd MMM yy", { locale: fr })}</TableCell>
                  <TableCell className="pr-2 text-right">
                    <Button variant="ghost" size="sm" className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                      title="Créer une règle depuis ce libellé"
                      onClick={() => onCreateRule({ description: r.rule_pattern, categoryId: r.category_id })}>
                      <Wand2 className="size-3.5" /> Règle
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
