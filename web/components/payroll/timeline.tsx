"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Employer, Payslip } from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";
import { gaps, monthName, monthsBetween, spanLabel, timeline, type Bounds, type Segment } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { Empty, Frame, Swatch, employerName } from "./common";

/* Drawn like the « frise » of life_planner (MetroTimeline.tsx), the user's other app:
   each stretch of an employer is a metro line between two stations, its name above it,
   overlapping stretches on rows below, a missing stretch dashed with a « ? ». */
const ROW_H = 40;
const LINE_W = 10;
const TOP = 4;
const AXIS_H = 30;
const MIN_PX_PER_MONTH = 16;          // under this the band scrolls instead of squeezing
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

let measureCtx: CanvasRenderingContext2D | null = null;
/** The label as wide as the line allows, cut with « … », or nothing below 24 px. */
function fitText(text: string, maxWidth: number): string {
  if (maxWidth < 24) return "";
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text;
  measureCtx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
  if (measureCtx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureCtx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 1 ? text.slice(0, lo) + "…" : "";
}

/** The employers across the period, in sequence on one band. Every currency:
 *  it says who paid when, not how much — the detail line under it does, in
 *  each employer's own currency. A click shows only that employer everywhere
 *  on the page; again, all of them. A « ? » is a month without a payslip
 *  between two of one employer's: it opens their list. */
export function EmployerTimeline({ payslips, bounds, employers, colors, selected, onSelect, onGap, onShowAll }: {
  /** The period's payslips, every employer and currency. */
  payslips: Payslip[];
  bounds: Bounds | null;
  employers: Employer[];
  colors: Map<number, string>;
  selected: number | null;
  onSelect: (employerId: number) => void;
  onGap: (employerId: number) => void;
  /** Offered while the period is not « Tout ». */
  onShowAll?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hover, setHover] = useState<Segment | null>(null);
  const [intro, setIntro] = useState(true);
  const { segments, lanes } = useMemo(() => timeline(payslips), [payslips]);
  const months = useMemo(() => (bounds ? monthsBetween(bounds.from, bounds.to) : []), [bounds]);
  const index = useMemo(() => new Map(months.map((m, i) => [m, i])), [months]);
  const n = months.length;
  const name = (id: number) => employerName(employers, id);
  const shown = segments.length > 0 && n > 0;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewWidth(el.clientWidth));
    observer.observe(el);
    setViewWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [shown]);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1600);
    return () => clearTimeout(t);
  }, []);

  const width = Math.max(viewWidth, n * MIN_PX_PER_MONTH);
  const px = n ? width / n : 0;
  const start = (m: string) => (index.get(m) ?? 0) * px;
  const end = (m: string) => ((index.get(m) ?? 0) + 1) * px;
  // Stations sit inside their months: two employers back to back never share one.
  const inset = Math.min(8, px / 4);
  const lineY = (row: number) => TOP + row * ROW_H + ROW_H - 12;
  const axisTop = TOP + Math.max(1, lanes) * ROW_H + 6;
  const height = axisTop + AXIS_H;
  /** Labels stick to the left edge of the view while their line is scrolled past. */
  const stickyX = (x1: number) => Math.max(x1 + 2, scrollLeft + 8);

  // Months of one employer without a payslip between two of its stretches, on one row.
  const holes = useMemo(() => {
    const missing = gaps(payslips);
    return segments.flatMap((s) => {
      const next = segments.find((o) => o.employerId === s.employerId && o.lane === s.lane && o.from > s.to);
      if (!next || segments.some((o) => o.employerId === s.employerId && o.from > s.to && o.from < next.from)) return [];
      const inside = missing.filter((g) => g.employer_id === s.employerId && g.period > s.to && g.period < next.from).map((g) => g.period);
      return inside.length ? [{ employerId: s.employerId, lane: s.lane, after: s.to, before: next.from, months: inside }] : [];
    });
  }, [segments, payslips]);

  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const todayX = index.has(thisMonth)
    ? start(thisMonth) + ((today.getDate() - 1) / new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) * px : null;

  const detail = (s: Segment) => {
    const mine = payslips.filter((p) => p.employer_id === s.employerId && p.period >= s.from && p.period <= s.to);
    const currency = mine[0]?.currency ?? "EUR";
    const gross = mine.reduce((t, p) => t + p.gross_cents, 0);
    const net = mine.reduce((t, p) => t + p.net_paid_cents, 0);
    return `${name(s.employerId)} · ${spanLabel(s)} · ${s.months} mois · brut ${formatCents(gross, currency)} · net versé ${formatCents(net, currency)}`;
  };

  // Axis: every January with its year; month ticks, then their names, as room allows.
  const januaries = months.flatMap((m, i) => (m.endsWith("-01") ? [i] : []));
  // The year of the left edge stays readable when no January label is near it.
  const leftMonth = months[Math.min(n - 1, Math.max(0, Math.floor(scrollLeft / Math.max(px, 1))))];
  const nearJanuary = januaries.some((i) => i * px > scrollLeft - 30 && i * px - scrollLeft < 60);
  const stickyYear = leftMonth && !nearJanuary ? leftMonth.slice(0, 4) : null;
  const clearOfYear = (mx: number) => !stickyYear || mx > scrollLeft + 44;

  const present = [...new Set(segments.map((s) => s.employerId))];
  return (
    <Frame title="Employeurs dans le temps" label="Frise des employeurs" action={onShowAll && (
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onShowAll}>Tout l&apos;historique</Button>
    )}>
      {!shown ? <Empty /> : (
        <div className="space-y-2">
          <div ref={scroller} className="payroll-metro overflow-x-auto overflow-y-hidden rounded-lg border border-border"
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
            <svg width={width} height={height} className={cn("block", intro && "intro")} role="group" aria-label="Frise">
              {januaries.filter((i) => i > 0).map((i) => (
                <line key={`g-${i}`} className="grid" x1={i * px} x2={i * px} y1={0} y2={axisTop} />
              ))}

              {holes.map((h) => {
                const x1 = end(h.after) - inset;
                const x2 = start(h.before) + inset;
                const y = lineY(h.lane);
                const label = `Aucune fiche de ${name(h.employerId)} : ${h.months.map(monthName).join(", ")}`;
                return (
                  <g key={`gap-${h.employerId}-${h.after}`} className="gap" role="button" tabIndex={0} aria-label={label}
                    style={{ ["--c" as string]: colors.get(h.employerId) }}
                    onClick={() => onGap(h.employerId)} onKeyDown={(e) => e.key === "Enter" && onGap(h.employerId)}>
                    {x2 - x1 > 30 && <line x1={x1 + 9} x2={x2 - 9} y1={y} y2={y} />}
                    <circle cx={(x1 + x2) / 2} cy={y} r={9} />
                    <text x={(x1 + x2) / 2} y={y + 4}>?</text>
                    <title>{label}. Cliquez pour voir ses fiches.</title>
                  </g>
                );
              })}

              {segments.map((s) => {
                const x1 = start(s.from) + inset;
                const x2 = Math.max(x1 + 4, end(s.to) - inset);
                const y = lineY(s.lane);
                const lx = stickyX(x1);
                const label = fitText(name(s.employerId), x2 - lx - 4);
                const aria = `${name(s.employerId)} : ${spanLabel(s)}, ${s.months} mois`;
                return (
                  <g key={`${s.employerId}-${s.from}`} role="button" tabIndex={0} aria-label={aria} aria-pressed={selected === s.employerId}
                    className={cn("seg", selected === s.employerId && "selected", selected != null && selected !== s.employerId && "dim")}
                    style={{ ["--c" as string]: colors.get(s.employerId), ["--delay" as string]: `${Math.round((x1 / width) * 700)}ms` }}
                    onClick={() => onSelect(s.employerId)} onKeyDown={(e) => e.key === "Enter" && onSelect(s.employerId)}
                    onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(s)} onBlur={() => setHover(null)}>
                    <rect className="hit" x={x1 - 6} y={y - 26} width={x2 - x1 + 12} height={34} />
                    <rect className="line" x={x1} y={y - LINE_W / 2} width={x2 - x1} height={LINE_W} rx={LINE_W / 2} />
                    <circle className="station" cx={x1} cy={y} r={6.5} />
                    {x2 - x1 > 14 && <circle className="station" cx={x2} cy={y} r={6.5} />}
                    {label && <text className="seg-label" x={lx} y={y - 13}>{label}</text>}
                    <title>{aria}</title>
                  </g>
                );
              })}

              <line className="axis-rule" x1={0} x2={width} y1={axisTop} y2={axisTop} />
              {months.map((m, i) => {
                const mx = i * px;
                if (m.endsWith("-01")) return <text key={m} className="year" x={mx + 4} y={axisTop + 20}>{m.slice(0, 4)}</text>;
                return (
                  <g key={m}>
                    {px >= 24 && <line className="month-tick" x1={mx} x2={mx} y1={axisTop} y2={axisTop + 6} />}
                    {px >= 44 && clearOfYear(mx) && <text className="month" x={mx + 3} y={axisTop + 19}>{MONTHS_SHORT[Number(m.slice(5)) - 1]}</text>}
                  </g>
                );
              })}
              {stickyYear && <text className="year" x={scrollLeft + 6} y={axisTop + 20}>{stickyYear}</text>}
              {todayX != null && <line className="today" x1={todayX} x2={todayX} y1={0} y2={axisTop} />}
            </svg>
          </div>
          <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
            {hover ? <span className="nums blurable">{detail(hover)}</span>
              : selected != null ? "Seul cet employeur est affiché : cliquez-le à nouveau pour les revoir tous."
                : "Survolez une ligne pour le détail ; cliquez-la pour n'afficher que cet employeur. Un « ? » est un mois sans fiche."}
          </p>
          <ul aria-label="Employeurs de la période" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {present.map((id) => {
              const mine = segments.filter((s) => s.employerId === id);
              return (
                <li key={id} className="flex items-center gap-1.5">
                  <Swatch color={colors.get(id)} />
                  <span className="font-medium">{name(id)}</span>
                  <span className="text-muted-foreground">· {mine.reduce((t, s) => t + s.months, 0)} mois · {mine.map((s) => spanLabel(s)).join(", ")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Frame>
  );
}
