"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { formatCents, formatCentsCompact, formatMonthLabel } from "@/lib/format";
import {
  KIND_LABEL, RATE_LABEL, change, formatRate, heldBack, heldElsewhere, monthName, rates, series, spanLabel, totals, yearRates,
  type Rates,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { Empty, Frame, Toggle, employerName, type PayrollView } from "./common";

const percent = (bp: number | null | undefined) => formatRate(bp, 1);
const perMille = (pm: number | null) =>
  pm == null ? null : `${pm > 0 ? "+" : pm < 0 ? "−" : ""}${(Math.abs(pm) / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

/** What the employer still holds back at the end of the period, every employer shown. */
const owedAt = (view: PayrollView) =>
  heldBack(view.all.filter((p) => !view.bounds || p.period <= view.bounds.to));

// ── The period in figures ───────────────────────────────────────────────────

/** The period's totals beside the same months a year earlier — « Depuis
 *  janvier » is the year chosen as the period. */
export function SummaryTiles({ view }: { view: PayrollView }) {
  const now = totals(view.payslips);
  const before = view.before ? totals(view.before.payslips) : null;
  const held = owedAt(view);
  const money = (c: number) => formatCents(c, view.currency);
  const tiles: { label: string; now: number; before?: number; note?: string }[] = [
    { label: "Brut", now: now.gross, before: before?.gross },
    { label: "Cotisations", now: now.contributions, before: before?.contributions },
    { label: "Impôt retenu", now: now.tax, before: before?.tax },
    { label: "Net versé", now: now.net, before: before?.net },
  ];
  if (held.length) {
    tiles.push({
      label: "Retenu, à recevoir", now: held.reduce((s, h) => s + h.balance, 0),
      note: now.held ? `dont ${money(now.held)} retenus sur la période` : "en fin de contrat",
    });
  }
  return (
    <section aria-label="Totaux de la période" className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {view.bounds ? spanLabel(view.bounds) : "—"} · {now.count} fiche{now.count > 1 ? "s" : ""} sur {now.months} mois
        {view.before && ` · comparé à ${spanLabel(view.before.bounds)}`}
      </p>
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", tiles.length === 5 && "lg:grid-cols-5")}>
        {tiles.map((t) => {
          const delta = t.before == null ? null : change(t.now, t.before);
          return (
            <div key={t.label} className="card-surface px-4 py-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="nums blurable text-xl font-semibold">{money(t.now)}</p>
              <p className="text-[11px] text-muted-foreground">
                {t.note ?? (view.before == null ? "sur toute la période" : delta == null ? "rien à comparer un an plus tôt" : `${perMille(delta)} sur un an`)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Évolution ───────────────────────────────────────────────────────────────

/** Gross split into what is paid, the tax and the contributions, month by
 *  month or year by year. Bars only: a period's total, no annotation. */
export function EvolutionCard({ view }: { view: PayrollView }) {
  const [mode, setMode] = useState<"month" | "year">("month");
  const points = series(view.payslips, mode).map((p) => ({
    period: p.period, "Net versé": p.net, "Retenu": Math.max(0, p.held), "Impôt": p.tax, "Cotisations": p.contributions, "Brut": p.gross,
  }));
  // Held back until the end of the contract: its own segment, only when there is some.
  const held = points.some((p) => p.Retenu > 0);
  const legend: [string, string][] = [["var(--positive)", "Net versé"], ...(held ? [["var(--color-violet-500)", "Retenu, à recevoir"] as [string, string]] : []),
    ["var(--warning)", "Impôt"], ["var(--negative)", "Cotisations"], ["var(--info)", "Brut (ligne)"]];
  const label = (p: string) => (mode === "year" ? p : formatMonthLabel(p));
  return (
    <Frame title="Évolution" action={<Toggle label="Pas" value={mode} onChange={setMode} options={[["month", "Mois"], ["year", "Années"]]} />}>
      {points.length === 0 ? <Empty /> : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={points} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={label} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => formatCentsCompact(v, view.currency)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={56} />
              <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                content={<ChartTooltip currency={view.currency} labelFormatter={(p) => (mode === "year" ? p : formatMonthLabel(p, { withYear: true }))} />} />
              <Bar dataKey="Net versé" stackId="pay" fill="var(--positive)" stroke="var(--surface)" strokeWidth={1} maxBarSize={28} />
              {held && <Bar dataKey="Retenu" stackId="pay" fill="var(--color-violet-500)" stroke="var(--surface)" strokeWidth={1} maxBarSize={28} />}
              <Bar dataKey="Impôt" stackId="pay" fill="var(--warning)" stroke="var(--surface)" strokeWidth={1} maxBarSize={28} />
              <Bar dataKey="Cotisations" stackId="pay" fill="var(--negative)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line dataKey="Brut" stroke="var(--info)" strokeWidth={2} dot={points.length === 1} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
          <ul aria-label="Légende" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {legend.map(([c, l]) => (
              <li key={l} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: c }} />{l}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            Chaque barre est le brut : ce qui vous est versé{held && ", ce que l'employeur retient jusqu'à la fin du contrat"}, l&apos;impôt retenu,
            les cotisations. Plusieurs employeurs le même mois s&apos;additionnent.
          </p>
        </>
      )}
    </Frame>
  );
}

// ── Taux ────────────────────────────────────────────────────────────────────

/** The curves of « Taux », in the review's block colours. « Non versé » is
 *  dashed: it is « Prélevé » plus what is held back, not another deduction. */
const RATE_CURVES: { key: keyof Rates; short: string; stroke: string; width: number; dash?: string }[] = [
  { key: "contributions", short: "Cotisations", stroke: "var(--color-orange-500)", width: 2 },
  { key: "tax", short: "Impôt", stroke: "var(--negative)", width: 2 },
  { key: "other", short: "Autres", stroke: "var(--info)", width: 2 },
  { key: "taken", short: "Prélevé", stroke: "var(--foreground)", width: 2.5 },
  { key: "unpaid", short: "Non versé", stroke: "var(--color-violet-500)", width: 2, dash: "5 4" },
];
const STROKE = Object.fromEntries(RATE_CURVES.map((c) => [c.key, c.stroke])) as Record<keyof Rates, string>;

export function RatesCard({ view, className }: { view: PayrollView; className?: string }) {
  const period = rates(totals(view.payslips));
  const years = yearRates(view.payslips).reverse();
  const points = series(view.payslips, "month").map((p) => {
    const r = rates(p);
    return { period: p.period, ...Object.fromEntries(RATE_CURVES.map((c) => [RATE_LABEL[c.key], r[c.key] == null ? null : r[c.key]! / 100])) };
  });
  const tariff = [...view.payslips].reverse().find((p) => p.withholding_rate_bp != null)?.withholding_rate_bp;
  const anyHeld = view.payslips.some((p) => p.lines.some((l) => l.kind === "retained" || l.kind === "released"));
  const tile = (key: keyof Rates, strong = false) => (
    <div key={key} className={cn("rounded-lg px-2 py-2", strong ? "bg-muted" : "bg-muted/50")}>
      <dt className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        {key !== "held" && <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: STROKE[key] }} />}
        {RATE_LABEL[key]}
      </dt>
      <dd className={cn("nums text-sm", strong ? "font-semibold" : "font-medium")}>{percent(period[key])}</dd>
    </div>
  );
  return (
    <Frame title="Taux" className={className}>
      {points.length === 0 ? <Empty /> : (
        <>
          <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
            {tile("contributions")}{tile("tax")}{tile("other")}
            {tile("taken", true)}{tile("held")}{tile("unpaid", true)}
          </dl>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="period" tickFormatter={(p) => formatMonthLabel(p)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `${v} %`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v: number) => percent(Math.round(v * 100))} labelFormatter={(p: string) => formatMonthLabel(p, { withYear: true })}
                contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              {RATE_CURVES.map((c) => (
                <Line key={c.key} dataKey={RATE_LABEL[c.key]} stroke={c.stroke} strokeWidth={c.width} strokeDasharray={c.dash} dot={points.length === 1} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            En part du brut de la période. « Prélevé (hors retenu) » part pour de bon : cotisations, impôt, autres retenues (cantine,
            parking…) moins les ajouts (frais, allocations) — vous gardez {percent(period.taken == null ? null : 10_000 - period.taken)}.
            {" "}« Non versé (retenu compris) » y ajoute ce que l&apos;employeur retient jusqu&apos;à la fin du contrat : ce que vous ne touchez pas
            le mois même, mais recevrez.{!anyHeld && " Aucune retenue sur la période : les deux taux sont égaux."}
            {tariff != null && ` Taux du barème imprimé sur la dernière fiche : ${formatRate(tariff)}.`}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table aria-label="Taux par année" className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Année</th>
                  {RATE_CURVES.map((c) => (
                    <th key={c.key} title={RATE_LABEL[c.key]} className="py-1.5 pl-2 text-right font-medium whitespace-nowrap">{c.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year} className="border-b border-border/60">
                    <td className="py-1.5 whitespace-nowrap">{y.year} <span className="text-xs text-muted-foreground">· {y.months} mois</span></td>
                    {RATE_CURVES.map((c) => (
                      <td key={c.key} className={cn("nums py-1.5 pl-2 text-right whitespace-nowrap", (c.key === "taken" || c.key === "unpaid") && "font-semibold")}>
                        {formatRate(y[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Le taux d&apos;une année est son total sur son brut total, sur les fiches de la période : un mois avec un bonus y pèse ce qu&apos;il pèse.
          </p>
        </>
      )}
    </Frame>
  );
}

// ── Retenues en attente ─────────────────────────────────────────────────────

/** Whether there is anything held back to show at all. */
export const hasRetained = (view: PayrollView) => owedAt(view).length > 0 || heldElsewhere(view.payslips).length > 0;

/** What employers hold back until the end of the contract (« Rückbehalt »):
 *  still owed at the end of the period — held since the start, not since the
 *  period began — and the period's months. */
export function RetainedCard({ view }: { view: PayrollView }) {
  const held = owedAt(view);
  const elsewhere = heldElsewhere(view.payslips);
  const money = (c: number) => formatCents(c, view.currency, { decimals: 2 });
  const inPeriod = (m: string) => !view.bounds || (m >= view.bounds.from && m <= view.bounds.to);
  return (
    <Frame title="Retenues en attente">
      <div className="space-y-4">
        {held.map((h) => {
          const months = h.months.filter((m) => inPeriod(m.period));
          const retained = months.reduce((s, m) => s + m.retained, 0);
          const released = months.reduce((s, m) => s + m.released, 0);
          return (
            <div key={h.employerId} className="space-y-3">
              {held.length > 1 && <p className="text-xs font-medium text-muted-foreground">{employerName(view.employers, h.employerId)}</p>}
              <div>
                <p className="nums blurable text-2xl font-semibold" aria-label="En attente">{money(h.balance)}</p>
                <p className="text-xs text-muted-foreground">
                  à recevoir en fin de contrat{view.bounds && `, à fin ${monthName(view.bounds.to)}`} · retenu depuis {monthName(h.since)}
                  {(retained > 0 || released > 0) && ` · sur la période : ${money(retained)} retenus${released ? `, ${money(released)} versés` : ""}`}
                </p>
              </div>
              {months.length > 0 && (
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
                      {[...months].reverse().map((m) => (
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
              )}
              <p className="text-[11px] text-muted-foreground">Lignes suivies : {h.labels.join(", ")}</p>
            </div>
          );
        })}
        {elsewhere.map((e) => (
          <div key={e.label} className="space-y-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs">
            <p>
              « {e.label} » est classée « {KIND_LABEL[e.kind]} » sur {e.payslips.length} fiche{e.payslips.length > 1 ? "s" : ""} :
              classez-la « {KIND_LABEL.retained} » pour la suivre ici. Les fiches suivantes de cet employeur le seront d&apos;elles-mêmes.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {e.payslips.slice(-6).reverse().map((p) => (
                <button key={p.id} type="button" className="text-brand hover:underline" onClick={() => view.onEdit(p)}>
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
