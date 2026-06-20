"use client";

import { toast } from "sonner";
import { Trash2, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useBankProfiles, useBankProfileMutations } from "@/lib/api/hooks";

export function ProfilesTab() {
  const { data: profiles = [] } = useBankProfiles();
  const { remove } = useBankProfileMutations();

  if (profiles.length === 0) {
    return <Card><EmptyState icon={FileSpreadsheet} title="Aucun profil bancaire" description="Les profils sont créés lors de l'import d'un relevé CSV (option « Sauvegarder ce format »)." /></Card>;
  }

  return (
    <Card className="divide-y divide-border p-0">
      {profiles.map((p) => (
        <div key={p.id} className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1">
            <p className="font-medium">{p.name}</p>
            <p className="font-mono text-xs text-muted-foreground">délim. « {p.delimiter} » · {p.encoding} · {p.date_format}</p>
          </div>
          <Badge variant="neutral">{Object.keys(p.column_mapping ?? {}).length} colonnes</Badge>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative"
            onClick={() => { if (confirm(`Supprimer le profil « ${p.name} » ?`)) remove.mutate(p.id, { onSuccess: () => toast.success("Profil supprimé") }); }}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </Card>
  );
}
