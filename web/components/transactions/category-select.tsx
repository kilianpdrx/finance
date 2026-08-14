"use client";

import { useState } from "react";
import { Archive, Ban } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "@/components/ui/select";
import { orderCategoryTree } from "@/lib/group";
import type { Category } from "@/lib/api/hooks";

const NONE = "__none__";

/** Muted "archivé" pill, reused wherever a retired category is shown. */
export function ArchivedBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground ${className}`}>
      <Archive className="size-2.5" /> archivé
    </span>
  );
}

/** Muted "clôturé" pill for a closed (deactivated) account. Same visual language
 *  as ArchivedBadge: the account keeps its history, it just isn't usable anymore. */
export function ClosedBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground ${className}`}>
      <Ban className="size-2.5" /> clôturé
    </span>
  );
}

/** Tint a category by its type so Revenus / Dépenses fixes / Dépenses variables
 *  are visually distinct in every picker. */
function typeAccent(c: Category): string {
  if (c.is_income) return "text-emerald-600 dark:text-emerald-400";
  if (c.expense_type === "fixed") return "text-indigo-600 dark:text-indigo-400";
  if (c.expense_type === "variable") return "text-amber-600 dark:text-amber-400";
  return "";
}

/** Category picker for editing a transaction's category (null = "Sans catégorie").
 *
 * When `accountId` is provided, only categories applicable to that account are
 * offered: global categories (account_id == null) + that account's categories.
 * `accountNames` is used to show each category's scope ("Global" / account name).
 * Archived categories are hidden (kept only if currently selected) with a
 * "Afficher les archivées" reveal, so old transactions can still be re-assigned. */
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
  showNamespace = false,
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
  /** Show the parent namespace as a "Parent › Category" prefix in the trigger. */
  showNamespace?: boolean;
}) {
  const [reveal, setReveal] = useState(false);

  const visible =
    accountId == null
      ? categories
      : categories.filter((c) => c.account_id == null || c.account_id === accountId);

  const scopeLabel = (c: Category) =>
    c.account_id == null ? "Global" : accountNames?.[c.account_id] ?? "Compte";

  const ordered = orderCategoryTree(visible);
  const parentIds = new Set(visible.filter((c) => c.parent_id != null).map((c) => c.parent_id));
  const anyArchived = visible.some((c) => c.archived);
  // Hide archived by default; always keep the currently-selected one visible.
  const shown = ordered.filter(({ cat }) => reveal || !cat.archived || cat.id === value);

  // Selected category + its parent namespace, for the custom trigger.
  const selected = value == null ? null : categories.find((c) => c.id === value) ?? null;
  const parent = selected?.parent_id != null ? categories.find((c) => c.id === selected.parent_id) ?? null : null;

  return (
    <Select
      value={value == null ? NONE : String(value)}
      onValueChange={(t) => onChange(t === NONE ? null : Number(t))}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        {selected ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: selected.color }} />
            {showNamespace && parent && <span className="shrink-0 text-muted-foreground">{parent.name} ›</span>}
            <span className={`truncate ${typeAccent(selected)} ${selected.archived ? "opacity-60" : ""}`}>{selected.name}</span>
            {selected.archived && <ArchivedBadge className="shrink-0" />}
          </span>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {!hideNone && <SelectItem value={NONE}>Sans catégorie</SelectItem>}
        {shown.map(({ cat: c, child }) => {
          if (!child && parentIds.has(c.id)) {
            return (
              <SelectGroup key={c.id}>
                <SelectLabel className={`mt-1 flex items-center gap-2 pl-8 ${typeAccent(c)} ${c.archived ? "opacity-60" : ""}`}>
                  <span className="size-2 rounded-full" style={{ background: c.color }} />
                  {c.name}
                  {c.archived && <ArchivedBadge />}
                  <span className="text-[10px] font-normal opacity-70">· {scopeLabel(c)}</span>
                </SelectLabel>
              </SelectGroup>
            );
          }
          return (
            <SelectItem key={c.id} value={String(c.id)} className={`${child ? "pl-12" : ""} ${c.archived ? "opacity-60" : ""}`}>
              <span className={`flex items-center gap-2 ${typeAccent(c)}`}>
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.name}
                {c.archived && <ArchivedBadge />}
                {!child && <span className="ml-1 text-[10px] text-muted-foreground">· {scopeLabel(c)}</span>}
              </span>
            </SelectItem>
          );
        })}
        {anyArchived && (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setReveal((v) => !v)}
            className="mt-1 flex w-full items-center gap-1.5 border-t border-border px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Archive className="size-3" /> {reveal ? "Masquer les archivées" : "Afficher les archivées"}
          </button>
        )}
      </SelectContent>
    </Select>
  );
}
