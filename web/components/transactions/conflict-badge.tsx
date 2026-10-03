"use client";

import { Layers, Pencil } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useAllRules, useCategories, type CategoryRule } from "@/lib/api/hooks";
import { ruleSummary } from "@/lib/rules";

/** Small badge shown when rules pointing to different categories match a
 *  transaction. Rules have no priority, so none of them is applied: the user
 *  settles it by editing a rule (or by picking the category by hand). Clicking the
 *  badge lists the rules involved; `onEditRule` adds a shortcut to open one. */
export function ConflictBadge({
  className = "",
  categories,
  ruleIds,
  onEditRule,
}: {
  className?: string;
  categories?: string[];
  ruleIds?: number[];
  onEditRule?: (rule: CategoryRule) => void;
}) {
  const badge = (
    <span className={`inline-flex items-center gap-0.5 rounded bg-warning/15 px-1 text-warning ${className}`}>
      <Layers className="size-3" /> conflit
    </span>
  );

  if (!categories?.length && !ruleIds?.length) {
    return <span title="Des règles de catégories différentes correspondent à cette transaction">{badge}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="cursor-help" onClick={(e) => e.stopPropagation()}>
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm">
        <ConflictDetail categories={categories} ruleIds={ruleIds} onEditRule={onEditRule} />
      </PopoverContent>
    </Popover>
  );
}

function ConflictDetail({ categories, ruleIds, onEditRule }: {
  categories?: string[];
  ruleIds?: number[];
  onEditRule?: (rule: CategoryRule) => void;
}) {
  const { data: allRules = [] } = useAllRules();
  const { data: allCategories = [] } = useCategories();
  const rules = (ruleIds ?? [])
    .map((id) => allRules.find((r) => r.id === id))
    .filter((r): r is CategoryRule => r !== undefined);
  const category = (id: number) => allCategories.find((c) => c.id === id);

  return (
    <>
      <p className="font-medium text-foreground">Des règles se contredisent</p>
      <p className="text-xs text-muted-foreground">
        Les règles n&apos;ont pas de priorité : quand elles désignent des catégories différentes, aucune
        n&apos;est appliquée. Modifiez l&apos;une d&apos;elles, ou choisissez la catégorie à la main.
      </p>
      {rules.length > 0 ? (
        <ul className="space-y-1.5">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: category(r.category_id)?.color ?? "var(--warning)" }} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{category(r.category_id)?.name ?? `#${r.category_id}`}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground" title={ruleSummary(r)}>{ruleSummary(r)}</span>
              </span>
              {onEditRule && (
                <button type="button" onClick={() => onEditRule(r)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Modifier cette règle" aria-label="Modifier cette règle">
                  <Pencil className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-0.5 text-muted-foreground">
          {(categories ?? []).map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-warning" /> {c}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
