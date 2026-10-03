"use client";

import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export type SortDir = "asc" | "desc";
export interface SortState<C extends string> {
  col: C;
  dir: SortDir;
}

/** Click cycle of a sortable column: its natural direction first, then the
 *  other one, then back to the table's default order (`null`). */
export function nextSort<C extends string>(current: SortState<C> | null, col: C, first: SortDir): SortState<C> | null {
  if (current?.col !== col) return { col, dir: first };
  if (current.dir === first) return { col, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

/** A column title that sorts its table. `first` is the direction of the first
 *  click: ascending for text, descending for amounts and counts. */
export function SortHeader<C extends string>({
  col,
  sort,
  onSort,
  first = "desc",
  children,
  className = "",
}: {
  col: C;
  sort: SortState<C> | null;
  onSort: (next: SortState<C> | null) => void;
  first?: SortDir;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort?.col === col;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, col, first))}
      aria-label={`Trier par ${typeof children === "string" ? children.toLowerCase() : col}`}
      className={`inline-flex items-center gap-1 hover:text-foreground ${className}`}
    >
      {children} <Icon className={`size-3 ${active ? "text-brand" : "text-muted-foreground/40"}`} />
    </button>
  );
}
