"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Check, Plus, Settings2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useProfiles } from "@/lib/api/hooks";
import { useProfileStore, useSelectedAccountsStore } from "@/lib/stores";
import { ProfileManageDialog } from "./profile-manage-dialog";
import { cn } from "@/lib/utils";

export function ProfileSwitcher() {
  const { data: profiles = [] } = useProfiles();
  const { activeProfileId, setActiveProfile } = useProfileStore();
  const setSelectedAccountIds = useSelectedAccountsStore((s) => s.setSelectedAccountIds);
  const qc = useQueryClient();
  const [manageOpen, setManageOpen] = useState(false);

  // Default to the default profile once the list loads.
  useEffect(() => {
    if (activeProfileId == null && profiles.length > 0) {
      setActiveProfile(profiles.find((p) => p.is_default)?.id ?? profiles[0].id);
    }
  }, [activeProfileId, profiles, setActiveProfile]);

  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const switchTo = (id: number) => {
    if (id === activeProfileId) return;
    setActiveProfile(id); // persisted to localStorage synchronously
    setSelectedAccountIds(null); // old profile's account ids no longer apply
    qc.clear();
    // Full reload so every page/store re-initialises cleanly under the new profile.
    window.location.reload();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 px-5 py-5 text-left transition-colors hover:bg-muted/50">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: active?.color ?? "#6366f1" }}>
              {active?.name?.[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold tracking-tight">{active?.name ?? "Finance"}</p>
              <p className="text-[11px] text-muted-foreground">Changer de profil</p>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Profils</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profiles.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => switchTo(p.id)} className="gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white" style={{ backgroundColor: p.color }}>
                {p.name[0]?.toUpperCase()}
              </span>
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === activeProfileId && <Check className="size-4 text-brand" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)} className="gap-2 text-muted-foreground">
            <Settings2 className="size-4" /> Gérer les profils
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManageOpen(true)} className="gap-2 text-muted-foreground">
            <Plus className="size-4" /> Nouveau profil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileManageDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  );
}
