"use client";

import { Tags, Wand2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SimilarUncategorized } from "@/lib/api/hooks";

/** Shown right after a transaction was given a category, when other uncategorised
 *  transactions carry the same label: classifying one row at a time is the
 *  tedious part of a first import. It only OFFERS — nothing is changed until the
 *  user clicks, and only rows without a category are ever concerned. */
export function SameLabelBar({
  similar,
  categoryName,
  busy,
  onApply,
  onCreateRule,
  onDismiss,
}: {
  similar: SimilarUncategorized;
  categoryName: string;
  busy?: boolean;
  onApply: () => void;
  onCreateRule: () => void;
  onDismiss: () => void;
}) {
  const n = similar.count;
  return (
    <Card className="flex flex-wrap items-center gap-2 border-brand/30 bg-brand/5 p-3">
      <Tags className="size-4 shrink-0 text-brand" />
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{n} autre{n > 1 ? "s" : ""} transaction{n > 1 ? "s" : ""} sans catégorie</span>{" "}
        {n > 1 ? "portent" : "porte"} le libellé « {similar.description} ».
      </span>
      <Button size="sm" disabled={busy} onClick={onApply}>
        {n > 1 ? "Les classer" : "La classer"} en {categoryName}
      </Button>
      <Button variant="outline" size="sm" onClick={onCreateRule} title="Classer aussi automatiquement les prochaines">
        <Wand2 className="size-4" /> Créer une règle…
      </Button>
      <Button variant="ghost" size="icon" className="size-8" onClick={onDismiss} aria-label="Ignorer">
        <X className="size-4" />
      </Button>
    </Card>
  );
}
