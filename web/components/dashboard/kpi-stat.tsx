"use client";

import { animate } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCents, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Accent = "brand" | "positive" | "negative" | "neutral";

const ACCENT_RING: Record<Accent, string> = {
  brand: "bg-brand/12 text-brand",
  positive: "bg-positive/12 text-positive",
  negative: "bg-negative/12 text-negative",
  neutral: "bg-muted text-muted-foreground",
};

/** Tween a money value when it changes (count-up effect). */
function AnimatedMoney({ cents, currency, signed }: { cents: number; currency: string; signed?: boolean }) {
  const [display, setDisplay] = useState(cents);
  const prev = useRef(cents);
  useEffect(() => {
    const controls = animate(prev.current, cents, {
      duration: 0.85,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = cents;
    return () => controls.stop();
  }, [cents]);
  return <span className="nums blurable">{formatCents(Math.round(display), currency, { sign: signed })}</span>;
}

export function KpiStat({
  label,
  valueCents,
  currency,
  icon: Icon,
  accent = "neutral",
  deltaPercent,
  signed,
  hint,
}: {
  label: string;
  valueCents: number;
  currency: string;
  icon: LucideIcon;
  accent?: Accent;
  deltaPercent?: number | null;
  signed?: boolean;
  hint?: string;
}) {
  const up = (deltaPercent ?? 0) >= 0;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-9 items-center justify-center rounded-xl", ACCENT_RING[accent])}>
          <Icon className="size-[18px]" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">
        <AnimatedMoney cents={valueCents} currency={currency} signed={signed} />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs">
        {deltaPercent != null && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", up ? "text-positive" : "text-negative")}>
            {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {formatPercent(Math.abs(deltaPercent))}
          </span>
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );
}
