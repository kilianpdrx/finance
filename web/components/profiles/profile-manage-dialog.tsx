"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfiles, useProfileMutations } from "@/lib/api/hooks";
import { useProfileStore } from "@/lib/stores";

const COLORS = ["#6366f1", "#ec4899", "#22c55e", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6"];

export function ProfileManageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: profiles = [] } = useProfiles();
  const { create, update, remove } = useProfileMutations();
  const { activeProfileId, setActiveProfile } = useProfileStore();
  const qc = useQueryClient();

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[1]);

  const addProfile = async () => {
    if (!newName.trim()) return;
    try {
      await create.mutateAsync({ name: newName.trim(), color: newColor });
      toast.success("Profil créé");
      setNewName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  const del = async (id: number) => {
    if (!confirm("Supprimer ce profil et toutes ses données ? Cette action est irréversible.")) return;
    try {
      await remove.mutateAsync(id);
      if (id === activeProfileId) {
        const fallback = profiles.find((p) => p.is_default) ?? profiles.find((p) => p.id !== id);
        if (fallback) { setActiveProfile(fallback.id); qc.clear(); }
      }
      toast.success("Profil supprimé");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gérer les profils</DialogTitle>
          <DialogDescription>Chaque profil a ses propres comptes, transactions, budgets et paramètres.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white" style={{ backgroundColor: p.color }}>
                {p.name[0]?.toUpperCase()}
              </span>
              <Input
                defaultValue={p.name}
                className="h-8 flex-1 border-transparent bg-transparent px-1 text-sm shadow-none hover:border-border focus:border-border"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) update.mutate({ id: p.id, body: { name: v } }); }}
              />
              {p.id === activeProfileId && <span title="Actif"><Check className="size-4 text-brand" /></span>}
              {p.is_default ? (
                <span className="text-[10px] text-muted-foreground">défaut</span>
              ) : (
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-negative" onClick={() => del(p.id)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Nouveau profil</p>
          <div className="flex items-center gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Maman, Colocation…" className="h-9" />
            <Button onClick={addProfile} disabled={create.isPending || !newName.trim()}><Plus className="size-4" /></Button>
          </div>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setNewColor(c)} className="size-6 rounded-full ring-offset-2 ring-offset-background transition" style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px ${c}` : undefined }} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
