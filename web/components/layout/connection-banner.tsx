"use client";

import { PlugZap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBackendHealth } from "@/lib/api/hooks";

/**
 * Shown across every page when the backend can't be reached.
 *
 * Without it each page just renders its empty state ("Aucun compte", the
 * first-run wizard…), which reads as "all my data is gone" to someone whose
 * data is perfectly fine — the server simply isn't running. The wording says so
 * explicitly and tells them what to do.
 */
export function ConnectionBanner() {
  const health = useBackendHealth();
  if (!health.isError) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-negative/30 bg-negative/10 px-4 py-2 text-sm text-negative sm:px-6"
    >
      <PlugZap className="size-4 shrink-0" />
      <span className="font-medium">Serveur inaccessible</span>
      <span className="text-negative/80">
        Vos données sont intactes — l&apos;application n&apos;arrive pas à les charger.
        Vérifiez que le serveur est démarré, puis réessayez.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="ml-auto h-7 border-negative/40 text-negative hover:bg-negative/10"
        onClick={() => health.refetch()}
        disabled={health.isFetching}
      >
        <RotateCcw className={`size-3.5 ${health.isFetching ? "animate-spin" : ""}`} /> Réessayer
      </Button>
    </div>
  );
}
