"use client";

import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLoanSchedule, type Loan } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

const fmtMonth = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });

function Inner({ loan }: { loan: Loan }) {
  const { data, isLoading } = useLoanSchedule(loan.id);
  if (isLoading || !data) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Chargement de l&apos;échéancier…</p>;
  }
  const rows = data.schedule;
  const chartData = rows.map((r) => ({ date: r.date, balance: r.balance_cents / 100 }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Capital restant</p>
          <p className="nums blurable font-semibold">{formatCents(loan.remaining_cents, loan.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Intérêts restants</p>
          <p className="nums font-semibold">{formatCents(loan.interest_remaining_cents, loan.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Fin estimée</p>
          <p className="font-semibold">{loan.payoff_date ? fmtMonth(loan.payoff_date) : "—"}</p>
        </div>
      </div>

      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="loanBal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={loan.color} stopOpacity={0.4} />
                <stop offset="100%" stopColor={loan.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tickFormatter={fmtMonth} tick={{ fontSize: 10 }} minTickGap={44} />
            <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 10 }} width={36} />
            <Tooltip
              formatter={(v: number) => formatCents(Math.round(v * 100), loan.currency)}
              labelFormatter={(l) => fmtMonth(l as string)}
            />
            <Area type="monotone" dataKey="balance" stroke={loan.color} fill="url(#loanBal)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-muted-foreground">
            <tr>
              <th className="p-2 text-left font-medium">Date</th>
              <th className="p-2 text-right font-medium">Mensualité</th>
              <th className="p-2 text-right font-medium">Intérêts</th>
              <th className="p-2 text-right font-medium">Capital</th>
              <th className="p-2 text-right font-medium">Restant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="p-2">{fmtMonth(r.date)}</td>
                <td className="nums p-2 text-right">{formatCents(r.payment_cents, loan.currency)}</td>
                <td className="nums p-2 text-right text-muted-foreground">{formatCents(r.interest_cents, loan.currency)}</td>
                <td className="nums p-2 text-right">{formatCents(r.principal_cents, loan.currency)}</td>
                <td className="nums p-2 text-right">{formatCents(r.balance_cents, loan.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LoanScheduleDialog({
  loan,
  onOpenChange,
}: {
  loan: Loan | null;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={loan !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Échéancier — {loan?.name}</DialogTitle>
        </DialogHeader>
        {loan && <Inner loan={loan} />}
      </DialogContent>
    </Dialog>
  );
}
