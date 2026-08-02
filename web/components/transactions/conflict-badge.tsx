import { Layers } from "lucide-react";

/** Small badge shown when several distinct categories match a transaction via
 *  rules — the user should pick one deliberately. */
export function ConflictBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Plusieurs catégories correspondent à cette transaction"
      className={`inline-flex items-center gap-0.5 rounded bg-warning/15 px-1 text-warning ${className}`}
    >
      <Layers className="size-3" /> conflit
    </span>
  );
}
