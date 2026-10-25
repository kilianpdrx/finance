"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, FileText, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { openPayslipDocument, type Employer, type Payslip } from "@/lib/api/hooks";
import { formatCents, formatCentsCompact, formatMonthLabel } from "@/lib/format";
import {
  EFFECT, KIND_LABEL, blockOf, breakdown, formatRate, gaps, heldBack, heldElsewhere, monthName, raises, rates, retainedBalance, series,
  share, yearRates, yearToDate, type Block, type Kind,
} from "@/lib/payroll";
import { WIDGETS } from "@/lib/payroll-widgets";
import { cn } from "@/lib/utils";

export interface WidgetProps {
  /** The payslips of the period shown, in one currency, oldest first. */
  payslips: Payslip[];
  /** Every payslip in that currency: what « depuis janvier » compares with. */
  all: Payslip[];
  employers: Employer[];
  currency: string;
  onEdit: (p: Payslip) => void;
  onDelete: (p: Payslip) => void;
}

function Frame({ id, children, className, action }: { id: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <Card className={className} aria-label={WIDGETS[id].title}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">{WIDGETS[id].title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const Empty = ({ text = "Aucune fiche sur cette période." }: { text?: string }) => (
  <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
);

// ── Le mois ─────────────────────────────────────────────────────────────────

export function MonthWidget({ payslips, all, currency, employers }: WidgetProps) {
  const periods = useMemo(() => [...new Set(payslips.map((p) => p.period))].sort().reverse(), [payslips]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const period = chosen && periods.includes(chosen) ? chosen : periods[0];
  const month = payslips.filter((p) => p.period === period);
  const previous = payslips.filter((p) => p.period === periods[periods.indexOf(period) + 1]);
  const money = (c: number) => formatCents(c, currency, { decimals: 2 });
  const name = (id: number) => employers.find((e) => e.id === id)?.name ?? "Employeur";

  return (
    <Frame id="month" action={periods.length > 0 && (
      <Select value={period} onValueChange={setChosen}>
        <SelectTrigger aria-label="Mois" className="h-8 w-44 text-xs capitalize"><SelectValue /></SelectTrigger>
        <SelectContent>{periods.map((p) => <SelectItem key={p} value={p} className="capitalize">{monthName(p)}</SelectItem>)}</SelectContent>
      </Select>
    )}>
      {month.length === 0 ? <Empty /> : month.map((p) => {
        const before = previous.find((x) => x.employer_id === p.employer_id);
        const held = retainedBalance(all, p.employer_id, p.period);
        const width = (c: number) => `${Math.min(100, (Math.abs(c) / Math.max(1, p.gross_cents)) * 100)}%`;
        // Each block in the review's colour; a block mixing both directions shows its sign.
        const row = (block: Block, cents: number, lines: Payslip["lines"]) => {
          const expandable = lines.length > 0;
          const key = `${p.id}-${block.id}`;
          const isOpen = open.has(key);
          const sign = block.id === "gross" ? "" : cents < 0 ? "− " : "+ ";
          return (
            <li key={block.id}>
              <button type="button" disabled={!expandable} aria-expanded={expandable ? isOpen : undefined}
                onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
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
          <div key={p.id} className="space-y-3">
            {month.length > 1 && <p className="text-xs font-medium text-muted-foreground">{name(p.employer_id)}</p>}
            <ul className="space-y-2.5">
              {row(blockOf("gross"), p.gross_cents, p.lines.filter((l) => l.kind === "gross"))}
              {breakdown(p).map((step) => row(step.block, step.effect, step.lines))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-sm font-semibold">Net versé</span>
              <span className="nums blurable text-lg font-semibold text-positive">{money(p.net_paid_cents)}</span>
            </div>
            {before && before.net_paid_cents !== p.net_paid_cents && (
              <p className="text-xs text-muted-foreground">
                {formatCents(p.net_paid_cents - before.net_paid_cents, currency, { sign: true, decimals: 2 })} par rapport à {monthName(before.period)}
              </p>
            )}
            {held && held.cents > 0 && (
              <p className="flex items-baseline justify-between gap-3 rounded-lg bg-violet-500/10 px-3 py-2 text-xs">
                <span>Retenu par l&apos;employeur, à recevoir en fin de contrat <span className="text-muted-foreground">· depuis {monthName(held.since)}</span></span>
                <span className="nums blurable font-semibold text-violet-600 dark:text-violet-400">{money(held.cents)}</span>
              </p>
            )}
          </div>
        );
      })}
    </Frame>
  );
}

// ── Évolution ───────────────────────────────────────────────────────────────

export function EvolutionWidget({ payslips, currency }: WidgetProps) {
  const [mode, setMode] = useState<"month" | "year">("month");
  const points = series(payslips, mode).map((p) => ({
    period: p.period, "Net versé": p.net, "Impôt": p.tax, "Cotisations": p.contributions, "Brut": p.gross,
  }));
  const ups = mode === "month" ? [...raises(payslips)] : [];
  const label = (p: string) => (mode === "year" ? p : formatMonthLabel(p));
  return (
    <Frame id="evolution" action={
      <div role="tablist" aria-label="Pas" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
        {([["month", "Mois"], ["year", "Années"]] as const).map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={mode === v} onClick={() => setMode(v)}
            className={cn("rounded-md px-2.5 py-1", mode === v ? "bg-brand/15 text-brand" : "text-muted-foreground")}>{l}</button>
        ))}
      </div>
    }>
      {points.length === 0 ? <Empty /> : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={points} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={label} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => formatCentsCompact(v, currency)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={56} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<ChartTooltip currency={currency} labelFormatter={(p) => (mode === "year" ? p : formatMonthLabel(p, { withYear: true }))} />} />
              <Bar dataKey="Net versé" stackId="pay" fill="var(--positive)" maxBarSize={28} />
              <Bar dataKey="Impôt" stackId="pay" fill="var(--warning)" maxBarSize={28} />
              <Bar dataKey="Cotisations" stackId="pay" fill="var(--negative)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line dataKey="Brut" stroke="var(--info)" strokeWidth={2} dot={false} type="monotone" />
              {ups.map((p) => <ReferenceLine key={p} x={p} stroke="var(--brand)" strokeDasharray="4 3" label={{ value: "hausse", position: "top", fontSize: 10, fill: "var(--brand)" }} />)}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Chaque barre est le brut : ce qui vous est versé, l&apos;impôt retenu, les cotisations. Les pointillés marquent un salaire de base qui change.
          </p>
        </>
      )}
    </Frame>
  );
}

// ── Depuis janvier ──────────────────────────────────────────────────────────

export function YtdWidget({ all, currency }: WidgetProps) {
  const year = Number((all.at(-1)?.period ?? String(new Date().getFullYear())).slice(0, 4));
  const { now, before, untilMonth } = yearToDate(all, year);
  const tiles: { label: string; now: number; before: number; tone?: string }[] = [
    { label: "Brut", now: now.gross, before: before.gross },
    { label: "Cotisations", now: now.contributions, before: before.contributions, tone: "text-negative" },
    { label: "Impôt", now: now.tax, before: before.tax, tone: "text-warning" },
    { label: "Net versé", now: now.net, before: before.net, tone: "text-positive" },
  ];
  return (
    <Frame id="ytd">
      {now.months === 0 ? <Empty text="Aucune fiche cette année." /> : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {year}, de janvier à {untilMonth ? monthName(`${year}-${untilMonth}`).split(" ")[0] : "—"} · {now.months} fiche{now.months > 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t) => {
              const change = t.before > 0 ? Math.round(((t.now - t.before) / t.before) * 1000) / 10 : null;
              return (
                <div key={t.label} className="rounded-xl bg-muted/50 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                  <p className={cn("nums blurable text-lg font-semibold", t.tone)}>{formatCents(t.now, currency)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {change == null ? "pas de fiche l'an dernier sur ces mois" : `${change > 0 ? "+" : ""}${change.toLocaleString("fr-FR")} % sur un an`}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Frame>
  );
}

// ── Taux ────────────────────────────────────────────────────────────────────

/** The curves of « Taux », in the review's block colours; « Total » is their sum. */
const RATE_CURVES = [
  { key: "contributions", label: "Cotisations", stroke: "var(--color-orange-500)", width: 2 },
  { key: "tax", label: "Impôt retenu", stroke: "var(--negative)", width: 2 },
  { key: "other", label: "Autres retenues", stroke: "var(--info)", width: 2 },
  { key: "total", label: "Total", stroke: "var(--foreground)", width: 2.5 },
] as const;

export function RatesWidget({ payslips, all }: WidgetProps) {
  const years = yearRates(all).reverse();
  const points = series(payslips, "month").map((p) => {
    const r = rates(p);
    return { period: p.period, ...Object.fromEntries(RATE_CURVES.map((c) => [c.label, r[c.key] == null ? null : r[c.key]! / 100])) };
  });
  const last = points.at(-1) as Record<string, number | null> | undefined;
  const tariff = [...payslips].reverse().find((p) => p.withholding_rate_bp != null)?.withholding_rate_bp;
  const percent = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`);
  return (
    <Frame id="rates">
      {!last ? <Empty /> : (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {RATE_CURVES.map((c) => (
              <div key={c.key} className="rounded-lg bg-muted/50 px-2 py-2">
                <dt className="text-[11px] text-muted-foreground">{c.label}</dt>
                <dd className="nums text-sm font-semibold" style={{ color: c.key === "total" ? undefined : c.stroke }}>{percent(last[c.label])}</dd>
              </div>
            ))}
          </dl>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={(p) => formatMonthLabel(p)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${v} %`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v: number) => percent(v)} labelFormatter={(p: string) => formatMonthLabel(p, { withYear: true })}
                contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              {RATE_CURVES.map((c) => (
                <Line key={c.key} dataKey={c.label} stroke={c.stroke} strokeWidth={c.width} dot={points.length === 1} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            En part du brut du mois. « Total » est la part du brut que vous ne recevez pas : vous en gardez {percent(last.Total == null ? null : 100 - last.Total)}.
            {" "}« Autres retenues » : cantine, parking…, moins les ajouts (frais, allocations). Les retenues en attente ne comptent pas :
            elles vous reviennent en fin de contrat.
            {tariff != null && ` Taux du barème imprimé sur la dernière fiche : ${formatRate(tariff)}.`}
          </p>
          <table aria-label="Taux par année" className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Année</th>
                {RATE_CURVES.map((c) => <th key={c.key} className="py-1.5 pl-2 text-right font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year} className="border-b border-border/60">
                  <td className="py-1.5 whitespace-nowrap">{y.year} <span className="text-xs text-muted-foreground">· {y.months} mois</span></td>
                  {RATE_CURVES.map((c) => (
                    <td key={c.key} className={cn("nums py-1.5 pl-2 text-right whitespace-nowrap", c.key === "total" && "font-semibold")}>{formatRate(y[c.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Le taux d&apos;une année est son total sur son brut total, sur toutes vos fiches : un mois avec un bonus y pèse ce qu&apos;il pèse.
          </p>
        </>
      )}
    </Frame>
  );
}

// ── Versements ──────────────────────────────────────────────────────────────

const DEPOSIT: Record<Payslip["deposit"]["status"], { label: string; className: string }> = {
  paid: { label: "versé", className: "bg-positive/10 text-positive" },
  gap: { label: "écart", className: "bg-warning/15 text-foreground" },
  missing: { label: "introuvable", className: "bg-negative/10 text-negative" },
  no_account: { label: "compte non choisi", className: "bg-muted text-muted-foreground" },
  other_currency: { label: "autre devise", className: "bg-muted text-muted-foreground" },
};

export function DepositsWidget({ payslips, employers, currency }: WidgetProps) {
  const missing = gaps(payslips);
  const name = (id: number) => employers.find((e) => e.id === id)?.name ?? "Employeur";
  const rows = [...payslips].reverse();
  return (
    <Frame id="deposits">
      {rows.length === 0 ? <Empty /> : (
        <>
          <ul aria-label="Versements par mois" className="divide-y divide-border">
            {rows.map((p) => {
              const d = p.deposit;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block capitalize">{monthName(p.period)}</span>
                    {employers.length > 1 && <span className="block text-xs text-muted-foreground">{name(p.employer_id)}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-right">
                    <span className="text-xs text-muted-foreground">
                      {d.date && `le ${new Date(d.date).toLocaleDateString("fr-FR")}`}
                      {d.status === "gap" && ` · ${formatCents(d.difference_cents, currency, { sign: true, decimals: 2 })}`}
                    </span>
                    <span className="nums blurable">{formatCents(p.net_paid_cents, currency, { decimals: 2 })}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", DEPOSIT[d.status].className)}
                      title={d.status === "no_account" ? "Choisissez le compte de cet employeur dans « Employeurs »" : d.description ?? undefined}>
                      {DEPOSIT[d.status].label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {missing.length > 0 && (
            <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs">
              Fiche{missing.length > 1 ? "s" : ""} manquante{missing.length > 1 ? "s" : ""} : {missing.map((g) => monthName(g.period)).join(", ")}.
            </p>
          )}
        </>
      )}
    </Frame>
  );
}

// ── Retenues en attente ─────────────────────────────────────────────────────

/** What employers hold back until the end of the contract (« Rückbehalt »):
 *  still owed, since when, month by month. Over every payslip, not the period
 *  shown — what is owed is what was held since the start. */
export function RetainedWidget({ all, employers, currency, onEdit }: WidgetProps) {
  const held = heldBack(all);
  const elsewhere = heldElsewhere(all);
  const money = (c: number) => formatCents(c, currency, { decimals: 2 });
  const name = (id: number) => employers.find((e) => e.id === id)?.name ?? "Employeur";
  return (
    <Frame id="retained">
      <div className="space-y-4">
        {held.length === 0 && elsewhere.length === 0 && (
          <Empty text="Aucune retenue : une ligne « Rückbehalt » de vos fiches apparaîtrait ici, avec ce qui reste à recevoir." />
        )}
        {held.map((h) => (
          <div key={h.employerId} className="space-y-3">
            {held.length > 1 && <p className="text-xs font-medium text-muted-foreground">{name(h.employerId)}</p>}
            <div>
              <p className="nums blurable text-2xl font-semibold text-violet-600 dark:text-violet-400" aria-label="En attente">{money(h.balance)}</p>
              <p className="text-xs text-muted-foreground">
                en attente, à recevoir en fin de contrat · retenu depuis {monthName(h.since)}
                {h.released > 0 && ` · ${money(h.released)} déjà versés`}
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto">
              <table aria-label="Retenues par mois" className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">Mois</th>
                    <th className="py-1.5 text-right font-medium">Retenu</th>
                    <th className="py-1.5 text-right font-medium">Versé</th>
                    <th className="py-1.5 text-right font-medium">En attente</th>
                  </tr>
                </thead>
                <tbody>
                  {[...h.months].reverse().map((m) => (
                    <tr key={m.period} className="border-b border-border/60">
                      <td className="py-1.5 capitalize">{monthName(m.period)}</td>
                      <td className="nums blurable py-1.5 text-right">{m.retained ? money(m.retained) : "—"}</td>
                      <td className="nums blurable py-1.5 text-right text-muted-foreground">{m.released ? money(m.released) : "—"}</td>
                      <td className="nums blurable py-1.5 text-right font-medium">{money(m.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">Lignes suivies : {h.labels.join(", ")}</p>
          </div>
        ))}
        {elsewhere.map((e) => (
          <div key={e.label} className="space-y-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs">
            <p>
              « {e.label} » est classée « {KIND_LABEL[e.kind]} » sur {e.payslips.length} fiche{e.payslips.length > 1 ? "s" : ""} :
              classez-la « {KIND_LABEL.retained} » pour la suivre ici. Les fiches suivantes de cet employeur le seront d&apos;elles-mêmes.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {e.payslips.slice(-6).reverse().map((p) => (
                <button key={p.id} type="button" className="text-brand hover:underline" onClick={() => onEdit(p)}>
                  Corriger {monthName(p.period)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ── Fiches de paie ──────────────────────────────────────────────────────────

export function PayslipsWidget({ payslips, employers, currency, onEdit, onDelete }: WidgetProps) {
  const name = (id: number) => employers.find((e) => e.id === id)?.name ?? "Employeur";
  const money = (c: number) => formatCents(c, currency, { decimals: 2 });
  return (
    <Frame id="payslips">
      {payslips.length === 0 ? <Empty /> : (
        <div className="overflow-x-auto">
          <table aria-label="Fiches de paie" className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Mois</th>
                <th className="py-1.5 text-left font-medium">Employeur</th>
                <th className="py-1.5 text-right font-medium">Brut</th>
                <th className="py-1.5 text-right font-medium">Impôt</th>
                <th className="py-1.5 text-right font-medium">Net versé</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {[...payslips].reverse().map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="py-1.5 capitalize">{monthName(p.period)}</td>
                  <td className="py-1.5 text-muted-foreground">{name(p.employer_id)}</td>
                  <td className="nums blurable py-1.5 text-right">{money(p.gross_cents)}</td>
                  <td className="nums blurable py-1.5 text-right text-muted-foreground">{money(p.withholding_cents)}</td>
                  <td className="nums blurable py-1.5 text-right font-medium">{money(p.net_paid_cents)}</td>
                  <td className="py-1.5 text-right">
                    <span className="inline-flex items-center gap-0.5">
                      {p.document_id != null && (
                        <Button variant="ghost" size="icon" className="size-7" title="Ouvrir le PDF" aria-label={`PDF de ${monthName(p.period)}`}
                          onClick={() => openPayslipDocument(p.document_id!).catch((e) => toast.error(e instanceof Error ? e.message : "Erreur"))}>
                          <FileText className="size-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Corriger ${monthName(p.period)}`} onClick={() => onEdit(p)}><Pencil className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-negative" aria-label={`Supprimer ${monthName(p.period)}`} onClick={() => onDelete(p)}><Trash2 className="size-3.5" /></Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Frame>
  );
}

export const WIDGET_COMPONENTS: Record<string, { component: (p: WidgetProps) => React.ReactElement; wide: boolean }> = {
  month: { component: MonthWidget, wide: false },
  ytd: { component: YtdWidget, wide: false },
  evolution: { component: EvolutionWidget, wide: true },
  rates: { component: RatesWidget, wide: false },
  deposits: { component: DepositsWidget, wide: false },
  payslips: { component: PayslipsWidget, wide: true },
  retained: { component: RetainedWidget, wide: false },
};
