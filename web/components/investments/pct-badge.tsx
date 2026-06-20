import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Performance badge: % change with optional money amount, colored by sign. */
export function PctBadge({ value, amountCents, currency }: { value: number | null | undefined; amountCents?: number | null; currency?: string }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const positive = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold", positive ? "bg-positive/12 text-positive" : "bg-negative/12 text-negative")}>
      {positive ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(value).toFixed(1)}%
      {amountCents != null && <span className="nums opacity-75">{positive ? "+" : "−"}{formatCents(Math.abs(amountCents), currency)}</span>}
    </span>
  );
}
