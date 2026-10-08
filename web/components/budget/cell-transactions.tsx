"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Inbox, MousePointerClick, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { api, unwrap } from "@/lib/api/client";
import { useCategories, type Transaction } from "@/lib/api/hooks";
import { cellTransactions, periodRange, type CellSelection } from "@/lib/budget";
import { formatCents, formatMonthLabel } from "@/lib/format";

/** The space to the right of the budget table: the transactions that make up the
 *  cell the user clicked.
 *
 *  One request per (period, account) — every cell of a month shares it — then the
 *  cell's categories are picked out locally. The request mirrors `budget_full`:
 *  internal transfers excluded, the budget's account scope applied. */
export function CellTransactions({
  selection,
  accountId,
  accountIds,
  currency,
  onClose,
}: {
  selection: CellSelection | null;
  /** The single account the budget is showing, if any. */
  accountId?: number;
  /** Otherwise, the accounts it covers (null = every account). */
  accountIds: number[] | null;
  currency: string;
  onClose: () => void;
}) {
  const { data: categories = [] } = useCategories();
  const period = selection?.period;
  const { data, isLoading, isError } = useQuery({
    // Under "transactions" so editing a transaction elsewhere refreshes the list.
    queryKey: ["transactions", "budget-period", period, accountId ?? "all"],
    enabled: period != null,
    queryFn: () =>
      unwrap(api.GET("/api/transactions", {
        params: { query: { ...periodRange(period!), account_id: accountId, is_internal_transfer: false, limit: 10000 } },
      })) as Promise<Transaction[]>,
  });
  const rows = useMemo(
    () => (selection ? cellTransactions(data ?? [], selection.categoryIds, accountId != null ? null : accountIds) : []),
    [data, selection, accountId, accountIds],
  );

  if (!selection) {
    return (
      <Card className="p-0">
        <EmptyState icon={MousePointerClick} title="Cliquez sur une cellule"
          description="Les transactions qui composent son montant s'affichent ici." />
      </Card>
    );
  }

  const periodText = selection.period.length === 4
    ? `Année ${selection.period}`
    : formatMonthLabel(selection.period, { withYear: true });
  const forecast = selection.value_cents - selection.actual_cents;
  // A total row mixes categories: say which one each transaction belongs to.
  const showCategory = selection.categoryIds.length > 1;
  const catName = (id: number | null | undefined) => categories.find((c) => c.id === id)?.name;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {selection.color && <span className="size-2 shrink-0 rounded-full" style={{ background: selection.color }} />}
            <span className="truncate" title={selection.label}>{selection.label}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {periodText} · <span className="nums blurable font-medium text-foreground">{formatCents(selection.value_cents, currency, { decimals: 2 })}</span>
          </p>
          {forecast !== 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              dont <span className="nums blurable">{formatCents(selection.actual_cents, currency, { decimals: 2 })}</span> de transactions
              et <span className="nums blurable">{formatCents(forecast, currency, { decimals: 2 })}</span> prévus ou ajustés à la main.
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onClose} aria-label="Fermer le détail">
          <X className="size-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : isError ? (
        <EmptyState icon={Inbox} title="Transactions indisponibles" description="Le serveur n'a pas répondu. Réessayez dans un instant." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title="Aucune transaction"
          description={forecast !== 0 ? "Ce montant est prévu ou ajusté à la main : aucune transaction ne lui correspond encore." : "Rien sur cette période."} />
      ) : (
        <>
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                <span className="nums w-12 shrink-0 text-xs text-muted-foreground">{format(new Date(t.date), "dd MMM", { locale: fr })}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={t.description}>{t.description}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {showCategory && catName(t.category_id) ? `${catName(t.category_id)} · ` : ""}{t.account_name}
                  </span>
                </span>
                <span className={`nums blurable shrink-0 text-sm font-semibold ${t.is_debit ? "text-negative" : "text-positive"}`}>
                  {t.is_debit ? "−" : "+"}{formatCents(t.amount_cents, t.currency, { decimals: 2 })}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {rows.length} transaction{rows.length > 1 ? "s" : ""}
          </p>
        </>
      )}
    </Card>
  );
}
