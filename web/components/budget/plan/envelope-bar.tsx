"use client";

import { formatCents } from "@/lib/format";
import { DONE_LABEL, barFill, isMinimum, standing, type EnvelopeKind } from "@/lib/budget-plan";
import { cn } from "@/lib/utils";

/** One envelope's month as a bar: what happened against what was planned, with
 *  a tick where the month stands today. A ceiling fills towards "too much"; a
 *  minimum (income, investment goal) fills towards "reached". */
export function EnvelopeBar({
  kind,
  realised,
  target,
  pace,
  currency,
  compact = false,
}: {
  kind: EnvelopeKind;
  realised: number;
  target: number;
  /** 0–1: how far into the month we are. 1 = the month is over. */
  pace: number;
  currency: string;
  compact?: boolean;
}) {
  const state = standing(kind, realised, target, pace >= 1);
  const minimum = isMinimum(kind);
  const gap = Math.abs(target - realised);
  const fill = state === "over" || state === "short" ? "bg-negative" : state === "reached" ? "bg-positive" : "bg-brand";

  let verdict: string;
  if (minimum) verdict = state === "reached" ? (realised > target ? `atteint, +${formatCents(gap, currency)}` : "atteint") : `manque ${formatCents(gap, currency)}`;
  else if (target <= 0) verdict = realised > 0 ? "rien de prévu" : "";
  else verdict = state === "over" ? `dépassé de ${formatCents(gap, currency)}` : `reste ${formatCents(gap, currency)}`;

  return (
    <div className="min-w-0">
      <div className="relative h-2 rounded-full bg-muted" role="progressbar"
        aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(realised, Math.max(target, 0))}
        aria-label={`${formatCents(realised, currency)} ${DONE_LABEL[kind]} sur ${formatCents(target, currency)}`}>
        <div className={cn("h-2 rounded-full transition-all", fill)} style={{ width: `${barFill(realised, target)}%` }} />
        {pace > 0 && pace < 1 && (
          <span aria-hidden title="Où en est le mois aujourd'hui"
            className="absolute -top-1 h-4 w-px bg-foreground/60" style={{ left: `${pace * 100}%` }} />
        )}
      </div>
      <div className={cn("mt-1 flex items-baseline justify-between gap-2 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
        <span className="nums blurable truncate">{formatCents(realised, currency)} {DONE_LABEL[kind]}</span>
        <span className={cn("nums blurable shrink-0", (state === "over" || state === "short") && "font-medium text-negative", state === "reached" && "text-positive")}>
          {verdict}
        </span>
      </div>
    </div>
  );
}
