"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Brain, Sparkles, GraduationCap } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, unwrap } from "@/lib/api/client";
import { useMlStatus, useMlMutations, useCategories } from "@/lib/api/hooks";

interface Suggestion {
  category_id: number;
  conditions: { field: string; operator: string; value: string }[];
  priority: number;
  logic_operator: string;
}

export function MlTab() {
  const { data: status } = useMlStatus();
  const { train } = useMlMutations();
  const { data: categories = [] } = useCategories();
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`;

  const suggestions = useQuery({
    queryKey: ["ml", "suggest-rules"],
    queryFn: () => unwrap(api.GET("/api/ml/suggest-rules", { params: { query: { top_n: 5 } } })) as Promise<Suggestion[]>,
    enabled: !!status?.trained,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Brain className="size-4 text-brand" /> Modèle de catégorisation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">État</p>
              <Badge variant={status?.trained ? "positive" : "neutral"}>{status?.trained ? "Entraîné" : "Non entraîné"}</Badge>
            </div>
            <div><p className="text-xs text-muted-foreground">Échantillons</p><p className="nums font-medium">{status?.sample_count ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Précision</p><p className="nums font-medium">{status?.accuracy != null ? `${Math.round(status.accuracy * 100)}%` : "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Dernier entraînement</p><p className="font-medium">{status?.last_trained ? new Date(status.last_trained).toLocaleString("fr-FR") : "—"}</p></div>
          </div>
          <Button
            onClick={() => train.mutate(undefined, {
              onSuccess: (r) => toast.success(`Modèle entraîné — précision ${Math.round((r as { accuracy: number }).accuracy * 100)}%`),
              onError: (e) => toast.error(e instanceof Error ? e.message : "Échec (min. 10 transactions catégorisées)"),
            })}
            disabled={train.isPending}
          >
            <GraduationCap className="size-4" /> {train.isPending ? "Entraînement…" : "Entraîner le modèle"}
          </Button>
        </CardContent>
      </Card>

      {status?.trained && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-warning" /> Règles suggérées</CardTitle></CardHeader>
          <CardContent>
            {suggestions.isLoading ? <p className="text-sm text-muted-foreground">Analyse…</p> : !suggestions.data?.length ? (
              <p className="text-sm text-muted-foreground">Aucune suggestion.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.data.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                    <span className="font-medium">{catName(s.category_id)}</span>
                    <span className="text-muted-foreground">si</span>
                    <span className="font-mono text-xs">{s.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(` ${s.logic_operator} `)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
