"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import { Inbox, Wand2, X } from "lucide-react";
import { Sheet, SheetContent, SheetClose } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CategorySelect } from "@/components/transactions/category-select";
import {
  useUncategorizedGroups, useTransactionMutations,
  type Category, type UncategorizedGroup,
} from "@/lib/api/hooks";
import { formatCents } from "@/lib/format";

/** "Classer par libellé": the uncategorised transactions grouped by label, most
 *  frequent first. Picking a category classifies the whole group at once, so a
 *  first import is a dozen choices instead of a few hundred.
 *
 *  Only transactions without a category are ever written (`only_uncategorized`),
 *  and only on the user's explicit choice. */
export function UncategorizedPanel({
  open,
  onOpenChange,
  categories,
  accountNames,
  onCreateRule,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: Category[];
  accountNames: Record<number, string>;
  onCreateRule: (prefill: { description: string; categoryId: number | null }) => void;
}) {
  const { data: groups, isLoading } = useUncategorizedGroups(open);
  const { bulkCategory } = useTransactionMutations();
  // A category bound to one account can't be given to rows of another: a group
  // spread over several accounts is only offered the global categories.
  const globalCategories = useMemo(() => categories.filter((c) => c.account_id == null), [categories]);
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? "la catégorie";

  const classify = async (g: UncategorizedGroup, categoryId: number | null) => {
    if (categoryId == null) return;
    try {
      const { updated } = await bulkCategory.mutateAsync({ ids: g.transaction_ids, category_id: categoryId, only_uncategorized: true });
      toast.success(`${updated} transaction${updated > 1 ? "s" : ""} classée${updated > 1 ? "s" : ""} en ${catName(categoryId)}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  };

  const remaining = groups?.reduce((n, g) => n + g.occurrences, 0) ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="Classer par libellé" className="w-full max-w-xl gap-0 p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-base font-semibold">Classer par libellé</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {groups?.length
                ? `${remaining} transaction${remaining > 1 ? "s" : ""} sans catégorie, regroupée${remaining > 1 ? "s" : ""} en ${groups.length} libellé${groups.length > 1 ? "s" : ""}. Choisir une catégorie classe tout le groupe.`
                : "Les transactions sans catégorie, regroupées par libellé."}
            </p>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Fermer"><X className="size-4" /></Button>
          </SheetClose>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : !groups?.length ? (
            <EmptyState icon={Inbox} title="Tout est classé 🎉" description="Aucune transaction sans catégorie." />
          ) : (
            <ul className="divide-y divide-border">
              {groups.map((g) => {
                const singleAccount = g.account_ids.length === 1 ? g.account_ids[0] : null;
                return (
                  <li key={`${g.description}|${g.currency}|${g.is_debit}`} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={g.description}>{g.description}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span className="nums font-medium text-foreground">{g.occurrences}×</span>
                        <span className={`nums blurable ${g.is_debit ? "text-negative" : "text-positive"}`}>
                          {g.is_debit ? "−" : "+"}{formatCents(g.total_cents, g.currency)}
                        </span>
                        <span>· dernière le {format(new Date(g.last_date), "dd MMM yy", { locale: fr })}</span>
                        {singleAccount != null && accountNames[singleAccount] && <span>· {accountNames[singleAccount]}</span>}
                      </p>
                    </div>
                    <div className="w-44 shrink-0">
                      <CategorySelect
                        value={null}
                        placeholder="Classer en…"
                        hideNone
                        categories={singleAccount != null ? categories : globalCategories}
                        accountId={singleAccount}
                        accountNames={accountNames}
                        disabled={bulkCategory.isPending}
                        className="h-8 text-xs"
                        onChange={(cid) => classify(g, cid)}
                      />
                    </div>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground"
                      title="Créer une règle pour ce libellé" aria-label={`Créer une règle pour ${g.description}`}
                      onClick={() => onCreateRule({ description: g.rule_pattern, categoryId: null })}>
                      <Wand2 className="size-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
