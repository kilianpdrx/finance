"use client";

import { FlaskConical } from "lucide-react";
import { useAppVersion } from "@/lib/api/hooks";

/**
 * Shown on every page when the app runs on a COPY of an installed app's data
 * (`./dev-data.sh`). The copy and the real thing look exactly alike, two ports
 * apart — and whatever is entered here is replaced at the next copy.
 */
export function DataCopyBanner() {
  const { data } = useAppVersion();
  const copiedAt = data?.data_copied_at;
  if (!copiedAt) return null;

  const when = new Date(copiedAt);
  const date = Number.isNaN(when.getTime())
    ? copiedAt
    : when.toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-foreground sm:px-6">
      <FlaskConical className="size-3.5 shrink-0 text-warning" />
      <span className="font-medium">Copie de test</span>
      <span className="text-muted-foreground">
        données copiées le {date}. Ce que vous modifiez ici ne touche pas l&apos;application installée, et sera remplacé à la prochaine copie.
      </span>
    </div>
  );
}
