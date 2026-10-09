"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTH_NAMES, joinMonth, parseYear, splitMonth } from "@/lib/months";
import { cn } from "@/lib/utils";

/** A month AND its year, as two explicit fields.
 *
 *  The browser's own `<input type="month">` is a bare text box in Safari and
 *  Firefox, and elsewhere a picker where the year is easy to miss — planning
 *  something for next March has to be obvious. The value stays `YYYY-MM`. */
export function MonthYearPicker({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (ym: string) => void;
  /** Names the two fields for assistive tech: "{label} : mois" / "{label} : année". */
  label: string;
  className?: string;
}) {
  const now = new Date();
  const parts = splitMonth(value) ?? { year: now.getFullYear(), month: now.getMonth() + 1 };
  // The year is typed digit by digit: keep what is being typed, and only pass
  // it on once it is a whole year.
  const [yearText, setYearText] = useState(String(parts.year));
  useEffect(() => { setYearText(String(parts.year)); }, [parts.year]);

  return (
    <div className={cn("flex gap-2", className)}>
      <Select value={String(parts.month)} onValueChange={(m) => onChange(joinMonth(parts.year, Number(m)))}>
        <SelectTrigger aria-label={`${label} : mois`} className="min-w-0 flex-1 capitalize"><SelectValue /></SelectTrigger>
        <SelectContent>
          {MONTH_NAMES.map((name, i) => (
            <SelectItem key={name} value={String(i + 1)} className="capitalize">{name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label={`${label} : année`}
        inputMode="numeric"
        maxLength={4}
        value={yearText}
        onChange={(e) => {
          const text = e.target.value.replace(/\D/g, "");
          setYearText(text);
          const year = parseYear(text);
          if (year != null) onChange(joinMonth(year, parts.month));
        }}
        onBlur={() => setYearText(String(parts.year))}
        className="nums w-20 shrink-0"
      />
    </div>
  );
}
