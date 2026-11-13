"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, Check, Plus, Settings2, Lock, LockKeyhole } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useProfiles, lockProfile, type Profile } from "@/lib/api/hooks";
import { getUnlockToken, useProfileStore, useSelectedAccountsStore } from "@/lib/stores";
import { resolveActiveProfile } from "@/lib/profile-lock";
import { useSidebarCollapsed } from "@/lib/sidebar";
import { cn } from "@/lib/utils";
import { ProfileManageDialog } from "./profile-manage-dialog";
import { UnlockForm } from "./unlock-form";

export function ProfileAvatar({ profile, className }: { profile?: Pick<Profile, "name" | "color">; className?: string }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center font-semibold text-white shadow-sm", className)}
      style={{ backgroundColor: profile?.color ?? "#6366f1" }}
      aria-hidden
    >
      {profile?.name?.[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** Open another profile. Leaving a profile with a PIN locks it: coming back asks again. */
export function useSwitchProfile() {
  const qc = useQueryClient();
  const { activeProfileId, setActiveProfile } = useProfileStore();
  const setSelectedAccountIds = useSelectedAccountsStore((s) => s.setSelectedAccountIds);
  return async (id: number) => {
    if (id === activeProfileId) return;
    if (activeProfileId != null && getUnlockToken(activeProfileId)) await lockProfile(activeProfileId);
    setActiveProfile(id); // persisted to localStorage synchronously
    setSelectedAccountIds(null); // old profile's account ids no longer apply
    qc.clear();
    // Full reload so every page/store re-initialises cleanly under the new profile.
    window.location.reload();
  };
}

/** `rail`: in the desktop sidebar, which can fold to its icons (the phone drawer never does). */
export function ProfileSwitcher({ rail = false }: { rail?: boolean }) {
  const { data: profiles = [] } = useProfiles();
  const { activeProfileId, setActiveProfile } = useProfileStore();
  const switchTo = useSwitchProfile();
  const [manageOpen, setManageOpen] = useState(false);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const folded = useSidebarCollapsed() && rail;

  // Default to the default profile once the list loads.
  useEffect(() => {
    if (activeProfileId == null && profiles.length > 0) {
      setActiveProfile(profiles.find((p) => p.is_default)?.id ?? profiles[0].id);
    }
  }, [activeProfileId, profiles, setActiveProfile]);

  const active = resolveActiveProfile(profiles, activeProfileId);

  const choose = (p: Profile) => {
    if (p.id === active?.id) return;
    if (p.has_pin) setPinFor(p);
    else void switchTo(p.id);
  };

  const lockNow = async () => {
    if (!active) return;
    await lockProfile(active.id);
    window.location.reload();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            title={folded ? `${active?.name ?? "Profil"} — changer de profil` : undefined}
            aria-label={folded ? `${active?.name ?? "Profil"} — changer de profil` : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 px-5 py-5 text-left transition-colors hover:bg-muted/50",
              rail && "[[data-sidebar=collapsed]_&]:justify-center [[data-sidebar=collapsed]_&]:px-0",
            )}
          >
            <ProfileAvatar profile={active} className="size-9 rounded-xl text-sm" />
            <div className={cn("min-w-0 flex-1 leading-tight", rail && "[[data-sidebar=collapsed]_&]:hidden")}>
              <p className="flex items-center gap-1 truncate text-sm font-semibold tracking-tight">
                <span className="truncate">{active?.name ?? "Finance"}</span>
                {active?.has_pin && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Protégé par un code PIN" />}
              </p>
              <p className="text-[11px] text-muted-foreground">Changer de profil</p>
            </div>
            <ChevronsUpDown className={cn("size-4 shrink-0 text-muted-foreground", rail && "[[data-sidebar=collapsed]_&]:hidden")} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Profils</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profiles.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => choose(p)} className="gap-2">
              <ProfileAvatar profile={p} className="size-5 rounded-md text-[10px]" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === active?.id ? (
                <Check className="size-4 text-brand" />
              ) : (
                p.has_pin && <Lock className="size-3.5 text-muted-foreground" aria-label="Code PIN" />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {active?.has_pin && (
            <DropdownMenuItem onSelect={lockNow} className="gap-2 text-muted-foreground">
              <LockKeyhole className="size-4" /> Verrouiller ce profil
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setManageOpen(true)} className="gap-2 text-muted-foreground">
            <Settings2 className="size-4" /> Gérer les profils
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setManageOpen(true)} className="gap-2 text-muted-foreground">
            <Plus className="size-4" /> Nouveau profil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProfileManageDialog open={manageOpen} onOpenChange={setManageOpen} />

      <Dialog open={pinFor != null} onOpenChange={(o) => { if (!o) setPinFor(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ProfileAvatar profile={pinFor ?? undefined} className="size-7 rounded-lg text-xs" />
              <span className="truncate">{pinFor?.name}</span>
            </DialogTitle>
            <DialogDescription>Ce profil est protégé par un code PIN.</DialogDescription>
          </DialogHeader>
          {pinFor && (
            <UnlockForm profileId={pinFor.id} profileName={pinFor.name} onUnlocked={() => void switchTo(pinFor.id)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
