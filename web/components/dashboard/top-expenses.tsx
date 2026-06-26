"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useTransactions, type AnalyticsQuery, type Transaction } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

/** Top 10 biggest expenses (debits, internal transfers excluded) for the period. */
export function TopExpenses({ query, currency }: { query: AnalyticsQuery; currency: string }) {
  const { data = [] } = useTransactions({
    date_from: query.date_from,
    date_to: query.date_to,
    is_debit: true,
    is_internal_transfer: false,
    limit: 1000,
  });

  const top = useMemo(
    () => [...(data as Transaction[])].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 10),
    [data],
  );

  if (top.length === 0) {
    return <EmptyState icon={Inbox} title="Aucune dépense sur la période" />;
  }

  return (
    <ul className="divide-y divide-border/60">
      {top.map((t) => (
        <li key={t.id} className="flex items-center gap-3 py-2">
          <span className="w-12 shrink-0 text-xs text-muted-foreground">
            {format(parseISO(t.date), "dd MMM", { locale: fr })}
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-1 text-sm">{t.description}</p>
            {t.account_name && <p className="truncate text-xs text-muted-foreground">{t.account_name}</p>}
          </div>
          <span className="nums blurable shrink-0 text-sm font-semibold text-negative">
            −{formatCents(t.amount_cents, t.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
