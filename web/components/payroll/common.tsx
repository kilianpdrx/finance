"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Employer, Payslip } from "@/lib/api/hooks";
import type { Bounds } from "@/lib/payroll";
import { cn } from "@/lib/utils";

/** What every part of « Salaire & impôts » is drawn from: the period chosen and
 *  the employer filter, applied once by the page. Every employer is in, whatever
 *  its currency: totals and charts that add employers up use `payslips` / `all`,
 *  converted to `currency`; what is one employer's or one payslip's uses `own` /
 *  `ownAll`, in its own currency. */
export interface PayrollView {
  /** The period's payslips in `currency` (converted when paid in another), filter applied, oldest first. */
  payslips: Payslip[];
  /** Every payslip in `currency`, filter applied: what is still held back
   *  is what was held since the start, not since the period began. */
  all: Payslip[];
  /** The period's payslips, each in its own currency. */
  own: Payslip[];
  /** Every payslip, each in its own currency, filter applied. */
  ownAll: Payslip[];
  /** The months shown; null when there is nothing to show. */
  bounds: Bounds | null;
  /** The same months a year earlier, and their payslips in `currency`; null for « Tout ». */
  before: { bounds: Bounds; payslips: Payslip[] } | null;
  employers: Employer[];
  /** Each employer's colour, fixed over every payslip. */
  colors: Map<number, string>;
  /** What totals and charts are in. */
  currency: string;
  /** Set when payslips of other currencies were converted to `currency`. */
  converted: { from: string[]; missing: Payslip[] } | null;
  /** The rates are still loading: totals would leave the other currencies out. */
  pending: boolean;
  onEdit: (p: Payslip) => void;
  onDelete: (p: Payslip) => void;
}

export function Frame({ title, children, className, action, label }: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  label?: string;
}) {
  return (
    <Card className={cn("min-w-0", className)} aria-label={label ?? title}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export const Empty = ({ text = "Aucune fiche sur cette période." }: { text?: string }) => (
  <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>
);

/** A two- or three-way switch above a chart: months or years, gross or net. */
export function Toggle<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg border border-border p-0.5 text-xs">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={cn("rounded-md px-2.5 py-1", value === v ? "bg-brand/15 text-brand" : "text-muted-foreground")}>{l}</button>
      ))}
    </div>
  );
}

/** An employer's colour beside its name: the name carries identity, the dot repeats it. */
export function Swatch({ color, className }: { color: string | undefined; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color ?? "var(--muted-foreground)" }} />;
}

export const employerName = (employers: Employer[], id: number) => employers.find((e) => e.id === id)?.name ?? "Employeur";

/** The currency an employer pays in, beside its name. */
export function CurrencyTag({ currency, className }: { currency: string; className?: string }) {
  return (
    <span title={`Payé en ${currency}`}
      className={cn("rounded border border-border px-1 py-px text-[10px] font-semibold tracking-wide text-muted-foreground", className)}>
      {currency}
    </span>
  );
}

export const DEPOSIT: Record<Payslip["deposit"]["status"], { label: string; className: string }> = {
  paid: { label: "versé", className: "bg-positive/10 text-positive" },
  gap: { label: "écart", className: "bg-warning/15 text-foreground" },
  missing: { label: "introuvable", className: "bg-negative/10 text-negative" },
  no_account: { label: "compte non choisi", className: "bg-muted text-muted-foreground" },
  other_currency: { label: "autre devise", className: "bg-muted text-muted-foreground" },
};

export function DepositBadge({ deposit }: { deposit: Payslip["deposit"] }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", DEPOSIT[deposit.status].className)}
      title={deposit.status === "no_account" ? "Choisissez le compte de cet employeur dans « Employeurs »" : deposit.description ?? undefined}>
      {DEPOSIT[deposit.status].label}
    </span>
  );
}
