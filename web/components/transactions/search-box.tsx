"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Search box that owns its own text state and only lifts a *debounced* value to
 *  the parent. Keystrokes re-render this tiny component, not the whole (heavy)
 *  transactions table, so typing stays instant. */
export function SearchBox({ onSearch, placeholder = "Rechercher…" }: { onSearch: (v: string) => void; placeholder?: string }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const t = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(t);
    // onSearch only calls stable state setters — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-8" placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}
