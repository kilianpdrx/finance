"use client";

import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { orderCategoryTree } from "@/lib/group";
import type { Category } from "@/lib/api/hooks";

const NONE = "__none__";

/** Category picker for editing a transaction's category (null = "Sans catégorie").
 *
 * When `accountId` is provided, only categories applicable to that account are
 * offered: global categories (account_id == null) + that account's categories.
 * `accountNames` is used to show each category's scope ("Global" / account name). */
export function CategorySelect({
  value,
  onChange,
  categories,
  disabled,
  className,
  placeholder = "Sans catégorie",
  accountId,
  accountNames,
  hideNone = false,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  categories: Category[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  accountId?: number | null;
  accountNames?: Record<number, string>;
  hideNone?: boolean;
}) {
  const visible =
    accountId == null
      ? categories
      : categories.filter((c) => c.account_id == null || c.account_id === accountId);

  const scopeLabel = (c: Category) =>
    c.account_id == null ? "Global" : accountNames?.[c.account_id] ?? "Compte";

  const ordered = orderCategoryTree(visible);
  // Parents (categories that have children) are grouping-only: rendered as
  // non-selectable headers so transactions can only land on a leaf.
  const parentIds = new Set(visible.filter((c) => c.parent_id != null).map((c) => c.parent_id));

  return (
    <Select
      value={value == null ? NONE : String(value)}
      onValueChange={(t) => onChange(t === NONE ? null : Number(t))}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {!hideNone && <SelectItem value={NONE}>Sans catégorie</SelectItem>}
        {ordered.map(({ cat: c, child }) => {
          if (!child && parentIds.has(c.id)) {
            return (
              <SelectLabel key={c.id} className="mt-1 flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.name}
                <span className="text-[10px] font-normal">· {scopeLabel(c)}</span>
              </SelectLabel>
            );
          }
          return (
            <SelectItem key={c.id} value={String(c.id)} className={child ? "pl-9" : undefined}>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.name}
                {!child && <span className="ml-1 text-[10px] text-muted-foreground">· {scopeLabel(c)}</span>}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
