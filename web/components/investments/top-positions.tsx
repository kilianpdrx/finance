"use client";

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PctBadge } from "./pct-badge";
import { isCashType } from "@/lib/asset-types";
import { sharePct, type Position } from "@/lib/investments";
import { formatCents, formatPercent } from "@/lib/format";

/** The largest lines of the whole portfolio, whatever account holds them. */
export function TopPositions({ positions, totalCents }: { positions: Position[]; totalCents: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Position</TableHead>
          <TableHead>Compte</TableHead>
          <TableHead className="text-right">Valeur</TableHead>
          <TableHead className="w-24 text-right">Part du total</TableHead>
          <TableHead className="w-28 text-right">+/- value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="max-w-0">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 font-mono text-xs font-semibold">{p.ticker.toUpperCase()}</span>
                <span className="truncate text-muted-foreground" title={p.name}>{p.name}</span>
              </div>
            </TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 shrink-0 rounded-full" style={{ background: p.accountColor }} />
                {p.accountName}
              </span>
            </TableCell>
            <TableCell className="nums blurable text-right font-semibold">{formatCents(p.valueCents, p.currency)}</TableCell>
            <TableCell className="nums text-right text-xs text-muted-foreground">{formatPercent(sharePct(p.valueCents, totalCents))}</TableCell>
            <TableCell className="text-right">
              {/* Cash is worth what it is: it has no gain to show. */}
              <PctBadge value={isCashType(p.assetType) ? null : p.gainPct} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
