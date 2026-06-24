"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useDateRangeStore, PRESET_LABELS, presetToDates, rangeLabel, type Preset } from "@/lib/stores";
import { cn } from "@/lib/utils";

export function DateRangePicker() {
  const { preset, dateFrom, dateTo, setPreset, setCustomRange } = useDateRangeStore();
  const presets = Object.keys(PRESET_LABELS) as Exclude<Preset, "custom">[];
  const current = preset === "custom" ? "Personnalisé" : PRESET_LABELS[preset];
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-auto gap-2 py-1.5">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="hidden flex-col items-start leading-tight sm:flex">
            <span>{current}</span>
            <span className="nums text-[10px] font-normal text-muted-foreground">{rangeLabel(dateFrom, dateTo)}</span>
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Période</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {presets.map((p) => {
          const r = presetToDates(p);
          return (
            <DropdownMenuItem key={p} onSelect={() => setPreset(p)} className="flex-col items-start gap-0.5">
              <span className={cn("text-sm", preset === p && "font-semibold text-brand")}>{PRESET_LABELS[p]}</span>
              <span className="nums text-[10px] text-muted-foreground">{rangeLabel(r.dateFrom, r.dateTo)}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Personnalisé</span>
          {preset === "custom" && <span className="text-[10px] text-brand">actif</span>}
        </DropdownMenuLabel>
        <div className="flex flex-col gap-2 px-2 pb-2" onClick={(e) => e.stopPropagation()}>
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Début
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
              className="nums rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Fin
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
              className="nums rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <Button size="sm" className="h-7" disabled={!from || !to} onClick={() => setCustomRange(from, to)}>
            Appliquer
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
