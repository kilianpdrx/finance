"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useProfiles } from "@/lib/api/hooks";
import { UnlockForm } from "./unlock-form";
import { ProfileAvatar, useSwitchProfile } from "./profile-switcher";

/** Shown instead of the page while the active profile waits for its PIN. */
export function ProfileLockScreen({ profileId }: { profileId: number }) {
  const { data: profiles = [] } = useProfiles();
  const qc = useQueryClient();
  const switchTo = useSwitchProfile();
  const profile = profiles.find((p) => p.id === profileId);
  const others = profiles.filter((p) => p.id !== profileId);
  const name = profile?.name ?? "Ce profil";

  return (
    <div className="flex min-h-[70vh] items-center justify-center py-8">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5 py-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <ProfileAvatar profile={profile} className="size-14 rounded-2xl text-xl" />
            <div>
              <p className="text-lg font-semibold tracking-tight">{name}</p>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                <Lock className="size-3.5" /> Profil protégé par un code PIN
              </p>
            </div>
          </div>

          {/* The cached errors of the locked profile's queries are refetched with the token. */}
          <UnlockForm profileId={profileId} profileName={name} onUnlocked={() => qc.invalidateQueries()} />

          {others.length > 0 && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">Ouvrir un autre profil</p>
              <div className="flex flex-wrap gap-2">
                {others.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => switchTo(p.id)}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
                  >
                    <ProfileAvatar profile={p} className="size-5 rounded-md text-[10px]" />
                    <span className="max-w-[10rem] truncate">{p.name}</span>
                    {p.has_pin && <Lock className="size-3 text-muted-foreground" aria-label="Code PIN" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
