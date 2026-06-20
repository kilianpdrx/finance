"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Category } from "@/lib/api/hooks";

const NONE = "__none__";

/** Category picker for editing a transaction's category (null = "Sans catégorie"). */
export function CategorySelect({
  value,
  onChange,
  categories,
  disabled,
  className,
  placeholder = "Sans catégorie",
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  categories: Category[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
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
        {categories.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
