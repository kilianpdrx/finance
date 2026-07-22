"use client";

import type { Account } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export type CourantSelection = "all" | number;

/** Segmented button group over the current accounts: [Tous] [Compte A] [Compte B]…
 *  Replaces the header account dropdown on Budget and Analyse des dépenses. */
export function CourantTabs({
  accounts,
  value,
  onChange,
  className,
}: {
  accounts: Account[];
  value: CourantSelection;
  onChange: (v: CourantSelection) => void;
  className?: string;
}) {
  const courant = accounts.filter((a) => a.account_type === "courant");
  if (courant.length <= 1) return null; // nothing to switch between

  const options: { key: string; label: string; value: CourantSelection; color?: string }[] = [
    { key: "all", label: "Tous", value: "all" },
    ...courant.map((a) => ({ key: String(a.id), label: a.name, value: a.id as CourantSelection, color: a.color })),
  ];

  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-brand text-brand-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
