import { Hand, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Who chose a transaction's category: a rule (« auto », on import or when the
 *  rules were applied) or the user (« manuel »). `category_source` is set by
 *  every write path; a row without a category has neither badge.
 *  `showManual`: the Transactions list only marks what a rule did — beside
 *  a category picker, a hand-chosen category needs no badge. */
export function CategorySourceBadge({ source, showManual = true, className }: {
  source: string | null | undefined;
  showManual?: boolean;
  className?: string;
}) {
  if (source === "rule") {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded bg-brand/10 px-1 text-[11px] font-medium text-brand", className)}
        title="Classée automatiquement par une règle">
        <Wand2 className="size-3" aria-hidden /> auto
      </span>
    );
  }
  if (source === "manual" && showManual) {
    return (
      <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[11px] font-medium text-muted-foreground", className)}
        title="Catégorie choisie à la main">
        <Hand className="size-3" aria-hidden /> manuel
      </span>
    );
  }
  return null;
}
