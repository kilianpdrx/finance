"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PctBadge } from "./pct-badge";
import type { InvestmentAccount } from "@/lib/api/hooks";
import { accountGain, sharePct } from "@/lib/investments";
import { formatCents, formatPercent } from "@/lib/format";

/** Every investment account on one line: what it is worth, what part of the
 *  whole it is, and what it has earned. A row opens the account in its tab. */
export function AccountsOverview({
  accounts,
  totalCents,
  onOpen,
}: {
  accounts: InvestmentAccount[];
  totalCents: number;
  onOpen: (acc: InvestmentAccount) => void;
}) {
  const rows = [...accounts].sort((a, b) => (b.current_value_cents ?? 0) - (a.current_value_cents ?? 0));

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Compte</TableHead>
          <TableHead className="w-28">Suivi</TableHead>
          <TableHead className="text-right">Valeur</TableHead>
          <TableHead className="w-56">Part du total</TableHead>
          <TableHead className="text-right">Plus-value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((acc) => {
          const value = acc.current_value_cents ?? 0;
          const share = sharePct(value, totalCents);
          const gain = accountGain(acc);
          return (
            <TableRow key={acc.id} className="cursor-pointer" onClick={() => onOpen(acc)}>
              <TableCell>
                <div className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: acc.color }} />
                  <div className="min-w-0">
                    {/* A real button, so the row can be opened from the keyboard too. */}
                    <button type="button" className="block truncate text-left font-medium hover:underline"
                      title="Ouvrir le détail du compte"
                      onClick={(e) => { e.stopPropagation(); onOpen(acc); }}>
                      {acc.name}
                    </button>
                    {acc.bank_name && <p className="truncate text-xs text-muted-foreground">{acc.bank_name}</p>}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={acc.has_holdings ? "brand" : "neutral"}
                  title={acc.has_holdings ? "Valorisé par ses positions, au cours du marché" : "Valorisé par vos relevés"}>
                  {acc.has_holdings ? "Live" : "Long terme"}
                </Badge>
              </TableCell>
              <TableCell className="nums blurable text-right font-semibold">
                {acc.current_value_cents != null ? formatCents(value, acc.currency) : "—"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, background: acc.color }} />
                  </div>
                  <span className="nums w-14 shrink-0 text-right text-xs text-muted-foreground">{formatPercent(share)}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <PctBadge value={gain.pct} amountCents={gain.cents} currency={acc.currency} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
