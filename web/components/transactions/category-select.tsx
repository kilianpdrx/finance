"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  categories: Category[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  accountId?: number | null;
  accountNames?: Record<number, string>;
}) {
  const visible =
    accountId == null
      ? categories
      : categories.filter((c) => c.account_id == null || c.account_id === accountId);

  const scopeLabel = (c: Category) =>
    c.account_id == null ? "Global" : accountNames?.[c.account_id] ?? "Compte";

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
        <SelectItem value={NONE}>Sans catégorie</SelectItem>
        {visible.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: c.color }} />
              {c.name}
              <span className="ml-1 text-[10px] text-muted-foreground">· {scopeLabel(c)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
