"use client";

import { useState } from "react";
import { Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function QuitButton() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [pending, setPending] = useState(false);

  const quit = async () => {
    setPending(true);
    try {
      // Backend frees ports 3000/5173/8000 then terminates; the request may
      // not resolve cleanly because the server is killed — that's expected.
      await fetch("/api/system/shutdown", { method: "POST" }).catch(() => {});
    } finally {
      setConfirmOpen(false);
      setStopped(true);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirmOpen(true)}
        aria-label="Quitter"
        title="Quitter"
        className="text-muted-foreground hover:text-negative"
      >
        <Power className="size-4" />
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(o) => !pending && setConfirmOpen(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Quitter l&apos;application&nbsp;?</DialogTitle>
            <DialogDescription>
              Les serveurs frontend et backend seront arrêtés et les ports
              (3000, 8000) libérés. Vous devrez relancer <code>./start.sh</code>{" "}
              pour rouvrir l&apos;application.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={quit} disabled={pending}>
              {pending ? "Arrêt…" : "Quitter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stopped && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm">
          <Power className="size-10 text-muted-foreground" />
          <p className="text-lg font-semibold">Serveurs arrêtés</p>
          <p className="max-w-xs text-center text-sm text-muted-foreground">
            Les ports ont été libérés. Relancez <code>./start.sh</code> dans le
            terminal pour rouvrir l&apos;application.
          </p>
        </div>
      )}
    </>
  );
}
