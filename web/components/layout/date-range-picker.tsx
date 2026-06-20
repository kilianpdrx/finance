"use client";

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
import { useDateRangeStore, PRESET_LABELS, type Preset } from "@/lib/stores";
import { cn } from "@/lib/utils";

export function DateRangePicker() {
  const { preset, setPreset } = useDateRangeStore();
  const presets = Object.keys(PRESET_LABELS) as Exclude<Preset, "custom">[];
  const current = preset === "custom" ? "Personnalisé" : PRESET_LABELS[preset];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="hidden sm:inline">{current}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Période</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {presets.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => setPreset(p)}>
            <span className={cn("flex-1", preset === p && "font-semibold text-brand")}>{PRESET_LABELS[p]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
