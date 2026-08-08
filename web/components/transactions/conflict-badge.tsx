"use client";

import { Layers } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

/** Small badge shown when several distinct categories match a transaction via
 *  rules — the user should pick one deliberately. When the conflicting category
 *  names are known, clicking the badge reveals them. */
export function ConflictBadge({ className = "", categories }: { className?: string; categories?: string[] }) {
  const badge = (
    <span className={`inline-flex items-center gap-0.5 rounded bg-warning/15 px-1 text-warning ${className}`}>
      <Layers className="size-3" /> conflit
    </span>
  );

  if (!categories?.length) {
    return <span title="Plusieurs catégories correspondent à cette transaction">{badge}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="cursor-help" onClick={(e) => e.stopPropagation()}>
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-1.5 text-sm">
        <p className="font-medium text-foreground">Plusieurs règles s&apos;appliquent</p>
        <ul className="space-y-0.5 text-muted-foreground">
          {categories.map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-warning" /> {c}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
