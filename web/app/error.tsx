"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card>
      <EmptyState
        icon={AlertTriangle}
        title="Une erreur est survenue"
        description={error.message || "Impossible de charger les données. Vérifiez que le backend est démarré."}
        action={
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="size-4" /> Réessayer
          </Button>
        }
      />
    </Card>
  );
}
