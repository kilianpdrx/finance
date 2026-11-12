"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import type { Payslip } from "@/lib/api/hooks";
import { formatCents, formatCentsCompact, formatMonthLabel } from "@/lib/format";
import {
  EFFECT, RATE_LABEL, baseSalary, blockOf, breakdown, byEmployer, employerSeries, formatRate, monthName, monthsBetween, rates,
  retainedBalance, series, share, spanLabel, type Block, type Kind,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { DepositBadge, Empty, Frame, Swatch, Toggle, employerName, type PayrollView } from "./common";

// ── One card per employer ───────────────────────────────────────────────────

export function EmployerCards({ view, onShowPayslips }: { view: PayrollView; onShowPayslips: (employerId: number) => void }) {
  const figures = byEmployer(view.payslips);
  if (figures.length === 0) return <Frame title="Employeurs"><Empty /></Frame>;
  return (
    <section aria-label="Employeurs" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {figures.map((f) => {
        const money = (c: number) => formatCents(c, f.currency);
        const base = baseSalary(view.all, f.employerId, view.bounds?.to);
        const held = retainedBalance(view.all, f.employerId, view.bounds?.to ?? "9999-12");
        const employer = view.employers.find((e) => e.id === f.employerId);
        const rows: [string, React.ReactNode][] = [
          ["Brut", money(f.totals.gross)],
          ["Net versé", money(f.totals.net)],
          ["Brut moyen par mois", money(Math.round(f.totals.gross / Math.max(1, f.totals.months)))],
          ["Impôt retenu", money(f.totals.tax)],
          [RATE_LABEL.taken, formatRate(f.rates.taken, 1)],
          [RATE_LABEL.unpaid, formatRate(f.rates.unpaid, 1)],
        ];
        if (base) rows.push(["Salaire de base", `${money(base.cents)} depuis ${monthName(base.since)}`]);
        if (held && held.cents) rows.push(["Retenu, à recevoir", money(held.cents)]);
        rows.push(["Versements retrouvés", employer?.account_id == null ? "compte non choisi" : `${f.deposits.found} sur ${f.deposits.total}`]);
        return (
          <article key={f.employerId} aria-label={employerName(view.employers, f.employerId)} className="card-surface space-y-3 px-4 py-3">
            <header>
              <h3 className="flex items-center gap-2 font-semibold">
                <Swatch color={view.colors.get(f.employerId)} />{employerName(view.employers, f.employerId)}
              </h3>
              <p className="text-xs text-muted-foreground">
                {spanLabel(f)} · {f.totals.count} fiche{f.totals.count > 1 ? "s" : ""}
              </p>
            </header>
            <dl className="space-y-1 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="nums blurable text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <Button variant="outline" size="sm" className="w-full" onClick={() => onShowPayslips(f.employerId)}>
              <ListChecks className="mr-1.5 size-3.5" /> Ses fiches de paie
            </Button>
          </article>
        );
      })}
    </section>
  );
}

// ── Employers side by side, month by month ──────────────────────────────────

/** Each employer's gross (or net paid), stacked month by month or year by
 *  year: who paid what, when. One currency, one axis. */
export function EmployerCompare({ view }: { view: PayrollView }) {
  const [metric, setMetric] = useState<"gross" | "net">("gross");
  const [mode, setMode] = useState<"month" | "year">("month");
  const ids = useMemo(() => byEmployer(view.payslips).map((f) => f.employerId), [view.payslips]);
  const data = useMemo(() => {
    if (!view.bounds || view.payslips.length === 0) return [];
    const months = employerSeries(view.payslips, metric, monthsBetween(view.bounds.from, view.bounds.to));
    if (mode === "month") return months;
    const years = new Map<string, Record<string, number | string>>();
    for (const row of months) {
      const year = String(row.period).slice(0, 4);
      const into = years.get(year) ?? { period: year };
      for (const [k, v] of Object.entries(row)) if (k !== "period") into[k] = (Number(into[k]) || 0) + Number(v);
      years.set(year, into);
    }
    return [...years.values()];
  }, [view.payslips, view.bounds, metric, mode]);
  return (
    <Frame title="Employeurs comparés" action={
      <div className="flex flex-wrap gap-2">
        <Toggle label="Montant" value={metric} onChange={setMetric} options={[["gross", "Brut"], ["net", "Net versé"]]} />
        <Toggle label="Pas" value={mode} onChange={setMode} options={[["month", "Mois"], ["year", "Années"]]} />
      </div>
    }>
      {data.length === 0 ? <Empty /> : (
        <>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={(p: string) => (mode === "year" ? p : formatMonthLabel(p))}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => formatCentsCompact(v, view.currency)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false} tickLine={false} width={56} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<ChartTooltip currency={view.currency} labelFormatter={(p) => (mode === "year" ? p : formatMonthLabel(p, { withYear: true }))} />} />
              {ids.map((id, i) => (
                <Bar key={id} dataKey={`e${id}`} name={employerName(view.employers, id)} stackId="employers" fill={view.colors.get(id)}
                  stroke="var(--surface)" strokeWidth={1} maxBarSize={28} radius={i === ids.length - 1 ? [4, 4, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <ul aria-label="Légende" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {ids.map((id) => {
              const total = view.payslips.filter((p) => p.employer_id === id).reduce((s, p) => s + (metric === "gross" ? p.gross_cents : p.net_paid_cents), 0);
              return (
                <li key={id} className="flex items-center gap-1.5">
                  <Swatch color={view.colors.get(id)} />{employerName(view.employers, id)}
                  <span className="nums blurable text-muted-foreground">· {formatCents(total, view.currency)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Frame>
  );
}

// ── Le mois ─────────────────────────────────────────────────────────────────

/** One month, each employer's payslip side by side: from the gross to the
 *  net paid, block by block, in the review's colours. */
export function MonthCard({ view }: { view: PayrollView }) {
  const periods = useMemo(() => [...new Set(view.payslips.map((p) => p.period))].sort().reverse(), [view.payslips]);
  const [chosen, setChosen] = useState<string | null>(null);
  const period = chosen && periods.includes(chosen) ? chosen : periods[0];
  const month = view.payslips.filter((p) => p.period === period);
  return (
    <Frame title="Le mois" action={periods.length > 0 && (
      <Select value={period} onValueChange={setChosen}>
        <SelectTrigger aria-label="Mois" className="h-8 w-44 text-xs capitalize"><SelectValue /></SelectTrigger>
        <SelectContent>{periods.map((p) => <SelectItem key={p} value={p} className="capitalize">{monthName(p)}</SelectItem>)}</SelectContent>
      </Select>
    )}>
      {month.length === 0 ? <Empty /> : (
        <div className={cn("grid gap-6", month.length > 1 && "lg:grid-cols-2", month.length > 2 && "2xl:grid-cols-3")}>
          {month.map((p) => <OnePayslip key={p.id} p={p} view={view} withName={month.length > 1 || view.employers.length > 1} />)}
        </div>
      )}
    </Frame>
  );
}

function OnePayslip({ p, view, withName }: { p: Payslip; view: PayrollView; withName: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const before = view.all.filter((x) => x.employer_id === p.employer_id && x.period < p.period).sort((a, b) => a.period.localeCompare(b.period)).at(-1);
  const held = retainedBalance(view.all, p.employer_id, p.period);
  const r = rates(series([p], "month")[0]);
  const money = (c: number) => formatCents(c, p.currency, { decimals: 2 });
  const width = (c: number) => `${Math.min(100, (Math.abs(c) / Math.max(1, p.gross_cents)) * 100)}%`;
  // Each block in the review's colour; a block mixing both directions shows its sign.
  const row = (block: Block, cents: number, lines: Payslip["lines"]) => {
    const expandable = lines.length > 0;
    const isOpen = open.has(block.id);
    const sign = block.id === "gross" ? "" : cents < 0 ? "− " : "+ ";
    return (
      <li key={block.id}>
        <button type="button" disabled={!expandable} aria-expanded={expandable ? isOpen : undefined}
          onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(block.id)) n.delete(block.id); else n.add(block.id); return n; })}
          className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-left text-sm disabled:cursor-default">
          <span className="flex items-center gap-1">
            {expandable ? <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} /> : <span className="w-3.5" />}
            {block.title}
            <span className="text-xs text-muted-foreground">{share(Math.abs(cents), p.gross_cents) != null && `· ${formatRate(share(Math.abs(cents), p.gross_cents), 1)}`}</span>
          </span>
          <span className={cn("nums blurable font-medium", block.tone.text)}>{sign}{money(Math.abs(cents))}</span>
          <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", block.tone.bar)} style={{ width: width(cents) }} />
          </span>
        </button>
        {expandable && isOpen && (
          <ul className="mt-1 space-y-0.5 pl-5 text-xs text-muted-foreground">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="truncate">{l.label}{l.rate_bp != null && ` · ${formatRate(l.rate_bp)}`}</span>
                <span className="nums blurable">{block.signed ? (EFFECT[l.kind as Kind] < 0 ? "− " : "+ ") : ""}{money(l.amount_cents)}</span>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };
  return (
    <div className="min-w-0 space-y-3">
      {withName && (
        <p className="flex items-center gap-2 text-sm font-medium">
          <Swatch color={view.colors.get(p.employer_id)} />{employerName(view.employers, p.employer_id)}
        </p>
      )}
      <ul className="space-y-2.5">
        {row(blockOf("gross"), p.gross_cents, p.lines.filter((l) => l.kind === "gross"))}
        {breakdown(p).map((step) => row(step.block, step.effect, step.lines))}
      </ul>
      <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className="flex items-center gap-2 text-sm font-semibold">Net versé <DepositBadge deposit={p.deposit} /></span>
        <span className="nums blurable text-lg font-semibold text-positive">{money(p.net_paid_cents)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {RATE_LABEL.taken} {formatRate(r.taken, 1)} · {RATE_LABEL.unpaid} {formatRate(r.unpaid, 1)}
        {before && before.net_paid_cents !== p.net_paid_cents
          && ` · ${formatCents(p.net_paid_cents - before.net_paid_cents, p.currency, { sign: true, decimals: 2 })} par rapport à ${monthName(before.period)}`}
      </p>
      {held && held.cents > 0 && (
        <p className="flex items-baseline justify-between gap-3 rounded-lg bg-violet-500/10 px-3 py-2 text-xs">
          <span>Retenu par l&apos;employeur, à recevoir en fin de contrat <span className="text-muted-foreground">· depuis {monthName(held.since)}</span></span>
          <span className="nums blurable font-semibold text-violet-600 dark:text-violet-400">{money(held.cents)}</span>
        </p>
      )}
    </div>
  );
}
