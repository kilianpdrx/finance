"use client";

import { useEffect, useState } from "react";
import { Sidebar, SidebarBrand, SidebarNav } from "./sidebar";
import { Topbar } from "./topbar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ConnectionBanner } from "./connection-banner";
import { DataCopyBanner } from "./data-copy-banner";
import { ProfileLockScreen } from "@/components/profiles/profile-lock-screen";
import { useProfiles } from "@/lib/api/hooks";
import { usePrivacyStore, useProfileStore, useProfileUnlockStore } from "@/lib/stores";
import { profileToUnlock } from "@/lib/profile-lock";
import { isEditableTarget, isMacPlatform, isSidebarShortcut, readSidebarCollapsed, setSidebarCollapsed } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const privacy = usePrivacyStore((s) => s.hidden);
  const { data: profiles = [] } = useProfiles();
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const tokens = useProfileUnlockStore((s) => s.tokens);
  const lockedId = useProfileUnlockStore((s) => s.lockedId);
  // A profile with a PIN shows nothing of its own until it is typed (the API
  // refuses it anyway: this is the interface catching up with that).
  const toUnlock = profileToUnlock(profiles, activeProfileId, tokens, lockedId);

  // ⌘B / Ctrl+B folds the desktop rail; at phone width, where the sidebar is a
  // drawer, it opens and closes the drawer instead.
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (!isSidebarShortcut(e, mac) || isEditableTarget(e.target)) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 1024px)").matches) setSidebarCollapsed(!readSidebarCollapsed());
      else setMobileOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn("flex h-dvh overflow-hidden", privacy && "privacy")}>
      <Sidebar />

      {/* Mobile nav drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SidebarBrand />
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <ConnectionBanner />
        <DataCopyBanner />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-[110rem]">
            {toUnlock != null ? <ProfileLockScreen profileId={toUnlock} /> : children}
          </div>
        </main>
      </div>
    </div>
  );
}
