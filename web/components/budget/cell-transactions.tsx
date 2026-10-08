"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Inbox, MousePointerClick, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CategorySelect } from "@/components/transactions/category-select";
import { api, unwrap } from "@/lib/api/client";
import { useAllAccounts, useCategories, useTransactionMutations, type Transaction } from "@/lib/api/hooks";
import { cellTransactions, periodRange, type CellAmounts, type CellSelection } from "@/lib/budget";
import { formatCents, formatMonthLabel } from "@/lib/format";

/** Where the full label of the hovered row is shown (viewport coordinates). */
interface HoverLabel {
  text: string;
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

/** The space to the right of the budget table: the transactions that make up the
 *  cell the user clicked.
 *
 *  One request per (period, account) — every cell of a month shares it — then the
 *  cell's categories are picked out locally. The request mirrors `budget_full`:
 *  internal transfers excluded, the budget's account scope applied.
 *
 *  Hovering a row shows its full label; clicking it opens a category picker, so a
 *  misfiled transaction is fixed right where it was spotted. */
export function CellTransactions({
  selection,
  amounts,
  accountId,
  accountIds,
  currency,
  onClose,
}: {
  selection: CellSelection | null;
  /** The cell's amounts as the table shows them now (null: not in the table). */
  amounts: CellAmounts | null;
  /** The single account the budget is showing, if any. */
  accountId?: number;
  /** Otherwise, the accounts it covers (null = every account). */
  accountIds: number[] | null;
  currency: string;
  onClose: () => void;
}) {
  const { data: categories = [] } = useCategories();
  const { data: allAccounts = [] } = useAllAccounts();
  const accountNames = useMemo(() => Object.fromEntries(allAccounts.map((a) => [a.id, a.name])) as Record<number, string>, [allAccounts]);
  const { update } = useTransactionMutations();
  const [openId, setOpenId] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverLabel | null>(null);

  const period = selection?.period;
  const { data, isLoading, isError } = useQuery({
    // Under "transactions" so editing a transaction — here or elsewhere — refreshes the list.
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
  const value = amounts?.value_cents ?? 0;
  const actual = amounts?.actual_cents ?? 0;
  const forecast = value - actual;
  // A total row mixes categories: say which one each transaction belongs to.
  const showCategory = selection.categoryIds.length > 1;
  const catName = (id: number | null | undefined) => categories.find((c) => c.id === id)?.name;

  // The full label floats next to the row instead of un-truncating it in place:
  // a row that grows under the cursor pushes the next one away, and the list
  // flickers as the pointer moves down it. Only shown when the label is cut.
  const showFullLabel = (row: HTMLElement, text: string) => {
    const label = row.querySelector<HTMLElement>("[data-label]");
    if (!label || label.scrollWidth <= label.clientWidth) return;
    const r = row.getBoundingClientRect();
    const below = r.bottom + 80 < window.innerHeight;
    setHover({ text, left: r.left, width: r.width, ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }) });
  };

  const setCategory = (t: Transaction, categoryId: number | null) =>
    update.mutate({ id: t.id, body: { category_id: categoryId } }, {
      onSuccess: () => {
        setOpenId(null);
        toast.success(categoryId == null ? "Catégorie retirée" : `Classée en ${catName(categoryId) ?? "la catégorie choisie"}`);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
    });

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {selection.color && <span className="size-2 shrink-0 rounded-full" style={{ background: selection.color }} />}
            <span className="truncate" title={selection.label}>{selection.label}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {periodText} · <span className="nums blurable font-medium text-foreground">{formatCents(value, currency, { decimals: 2 })}</span>
          </p>
          {forecast !== 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              dont <span className="nums blurable">{formatCents(actual, currency, { decimals: 2 })}</span> de transactions
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
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto" onScroll={() => setHover(null)}>
            {rows.map((t) => {
              const open = openId === t.id;
              return (
                <li key={t.id} className={open ? "bg-muted/40" : ""}>
                  <button
                    type="button"
                    aria-expanded={open}
                    title={open ? undefined : "Cliquer pour changer la catégorie"}
                    onClick={() => { setHover(null); setOpenId(open ? null : t.id); }}
                    onMouseEnter={(e) => { if (!open) showFullLabel(e.currentTarget, t.description); }}
                    onMouseLeave={() => setHover(null)}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/40"
                  >
                    <span className="nums w-12 shrink-0 text-xs text-muted-foreground">{format(new Date(t.date), "dd MMM", { locale: fr })}</span>
                    <span className="min-w-0 flex-1">
                      {/* Cut to one line in the list; whole once the row is open. */}
                      <span data-label className={`block text-sm ${open ? "break-words" : "truncate"}`}>{t.description}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {showCategory && catName(t.category_id) ? `${catName(t.category_id)} · ` : ""}{t.account_name}
                      </span>
                    </span>
                    <span className={`nums blurable shrink-0 text-sm font-semibold ${t.is_debit ? "text-negative" : "text-positive"}`}>
                      {t.is_debit ? "−" : "+"}{formatCents(t.amount_cents, t.currency, { decimals: 2 })}
                    </span>
                  </button>
                  {open && (
                    <div className="flex items-center gap-2 px-4 pb-3 pl-[4.75rem]">
                      <span className="shrink-0 text-xs text-muted-foreground">Catégorie</span>
                      <div className="min-w-0 flex-1">
                        <CategorySelect
                          value={t.category_id}
                          categories={categories}
                          accountId={t.account_id}
                          accountNames={accountNames}
                          showNamespace
                          disabled={update.isPending}
                          className="h-8 text-xs"
                          onChange={(cid) => setCategory(t, cid)}
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {rows.length} transaction{rows.length > 1 ? "s" : ""}
          </p>
        </>
      )}

      {hover && (
        <div role="tooltip"
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground shadow-xl break-words"
          style={{ left: hover.left, width: hover.width, top: hover.top, bottom: hover.bottom }}>
          {hover.text}
        </div>
      )}
    </Card>
  );
}
