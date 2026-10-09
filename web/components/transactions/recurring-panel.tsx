"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Inbox, Wand2 } from "lucide-react";
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
 *  appears in no transaction at all.
 *
 *  A row unfolds into the group's real transactions: the keyword is a summary,
 *  and what a rule has to match is the labels as the bank wrote them. */
export function RecurringPanel({
  kind,
  accountId,
  categories,
  accountNames,
  onCreateRule,
}: {
  kind: "recurring" | "uncovered";
  /** One account, or null for all of them. */
  accountId: number | null;
  categories: Category[];
  /** Account id → name, for the unfolded rows. */
  accountNames: Record<number, string>;
  onCreateRule: (prefill: { description: string; categoryId: number | null }) => void;
}) {
  const [income, setIncome] = useState(false);
  // Open groups, by key. Several can be open: comparing two labels is the point.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const accountIds = accountId == null ? undefined : String(accountId);
  // Only the list being shown is fetched: each one scans every transaction.
  const recurring = useRecurring(accountIds, income, kind === "recurring");
  const uncovered = useRecurringUncovered(accountIds, income, kind === "uncovered");
  const { data, isLoading } = kind === "recurring" ? recurring : uncovered;
  const rows = (data ?? []) as RecurringTransaction[];
  const category = (id: number | null) => categories.find((c) => c.id === id);
  const catName = (id: number | null) => category(id)?.name ?? "—";
  const day = (iso: string) => format(new Date(iso), "dd MMM yy", { locale: fr });

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
              {rows.map((r) => {
                const key = `${r.description}|${r.currency}`;
                const isOpen = open.has(key);
                return (
                  <Fragment key={key}>
                    <TableRow className="group cursor-pointer" onClick={() => toggle(key)}>
                      <TableCell className="max-w-xs">
                        <span className="flex items-center gap-1.5">
                          {/* A real button, so the row unfolds from the keyboard too. */}
                          <button type="button" aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Masquer" : "Voir"} les transactions de ${r.description}`}
                            onClick={(e) => { e.stopPropagation(); toggle(key); }}
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                            <ChevronRight className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          </button>
                          <span className="line-clamp-1 font-medium">{r.description}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{catName(r.category_id)}</TableCell>
                      <TableCell className="nums text-right">{r.occurrences}×</TableCell>
                      <TableCell className="nums blurable text-right font-semibold">{formatCents(r.avg_amount_cents, r.currency)}</TableCell>
                      <TableCell className="nums text-right text-muted-foreground">{day(r.last_date)}</TableCell>
                      <TableCell className="pr-2 text-right">
                        <Button variant="ghost" size="sm" className="gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          title="Créer une règle depuis ce libellé"
                          onClick={(e) => { e.stopPropagation(); onCreateRule({ description: r.rule_pattern, categoryId: r.category_id }); }}>
                          <Wand2 className="size-3.5" /> Règle
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/40 p-0">
                          <ul aria-label={`Transactions de ${r.description}`} className="divide-y divide-border/60 py-1 pl-9 pr-4 text-xs">
                            {r.transactions.map((t) => {
                              const cat = category(t.category_id ?? null);
                              return (
                                <li key={t.id} className="flex items-center gap-3 py-1.5">
                                  <span className="nums w-20 shrink-0 whitespace-nowrap text-muted-foreground">{day(t.date)}</span>
                                  <span className="min-w-0 flex-1 truncate" title={t.description}>{t.description}</span>
                                  <span className="w-32 shrink-0 truncate text-muted-foreground">{t.account_id != null ? accountNames[t.account_id] ?? "" : ""}</span>
                                  <span className="flex w-40 shrink-0 items-center gap-1.5">
                                    {cat ? (
                                      <>
                                        <span className="size-2 shrink-0 rounded-full" style={{ background: cat.color }} />
                                        <span className="truncate">{cat.name}</span>
                                      </>
                                    ) : (
                                      <span className="text-muted-foreground/70">Sans catégorie</span>
                                    )}
                                  </span>
                                  <span className="nums blurable w-24 shrink-0 text-right font-medium">{formatCents(t.amount_cents, r.currency)}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
