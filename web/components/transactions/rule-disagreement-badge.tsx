"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useAllRules, useCategories, type CategoryRule } from "@/lib/api/hooks";
import { ruleSummary } from "@/lib/rules";

/** Shown on a transaction the user classified by hand when the rules all agree
 *  on ANOTHER category. Nothing is rewritten for it: a hand label is kept, by
 *  « Réappliquer » included. The badge only makes the disagreement visible, and
 *  lets the user settle it — follow the rule, or edit it. Doing neither is a
 *  valid answer: the exception stays an exception. */
export function RuleDisagreementBadge({
  currentCategoryId,
  ruleCategoryId,
  ruleIds,
  onEditRule,
  onFollow,
  following = false,
}: {
  currentCategoryId: number | null | undefined;
  ruleCategoryId: number;
  ruleIds: number[];
  onEditRule?: (rule: CategoryRule) => void;
  /** Replace the hand label with the rules' category. */
  onFollow?: () => void;
  following?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="cursor-help rounded bg-warning/15 px-1 text-warning"
          title="Vos règles classeraient cette transaction autrement" onClick={(e) => e.stopPropagation()}>
          ≠ règle
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-sm">
        <Detail currentCategoryId={currentCategoryId} ruleCategoryId={ruleCategoryId} ruleIds={ruleIds}
          onEditRule={onEditRule} onFollow={onFollow} following={following} />
      </PopoverContent>
    </Popover>
  );
}

function Detail({ currentCategoryId, ruleCategoryId, ruleIds, onEditRule, onFollow, following }: {
  currentCategoryId: number | null | undefined;
  ruleCategoryId: number;
  ruleIds: number[];
  onEditRule?: (rule: CategoryRule) => void;
  onFollow?: () => void;
  following: boolean;
}) {
  const { data: allRules = [] } = useAllRules();
  const { data: categories = [] } = useCategories();
  const name = (id: number | null | undefined) => categories.find((c) => c.id === id)?.name ?? `#${id}`;
  const rules = ruleIds.map((id) => allRules.find((r) => r.id === id)).filter((r): r is CategoryRule => r !== undefined);

  return (
    <>
      <p className="font-medium text-foreground">Vos règles disent autre chose</p>
      <p className="text-xs text-muted-foreground">
        Vous avez classé cette transaction en « {name(currentCategoryId)} ». Vos règles la classeraient
        en « {name(ruleCategoryId)} ». Votre choix est conservé tant que vous ne suivez pas la règle.
      </p>
      {rules.length > 0 && (
        <ul className="space-y-1.5">
          {rules.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              <span className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ background: categories.find((c) => c.id === r.category_id)?.color ?? "var(--warning)" }} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{name(r.category_id)}</span>
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
      )}
      {onFollow && (
        <Button size="sm" variant="outline" className="w-full" disabled={following} onClick={onFollow}>
          Suivre la règle : classer en « {name(ruleCategoryId)} »
        </Button>
      )}
    </>
  );
}
