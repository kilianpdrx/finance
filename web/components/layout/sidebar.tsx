"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ITEMS, DEFAULT_MODULES, ROUTE_MODULE } from "@/lib/nav";
import { ProfileSwitcher } from "@/components/profiles/profile-switcher";
import { useActiveProfile } from "@/lib/api/hooks";
import { isMacPlatform, setSidebarCollapsed, shortcutLabel, useSidebarCollapsed } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** `rail`: the desktop sidebar, which can fold to its icons; the phone drawer never folds. */
export function SidebarNav({ onNavigate, rail = false }: { onNavigate?: () => void; rail?: boolean }) {
  const pathname = usePathname();
  const activeProfile = useActiveProfile();
  const enabledModules = activeProfile?.enabled_modules ?? DEFAULT_MODULES;
  const folded = useSidebarCollapsed() && rail;

  const filteredNavItems = NAV_ITEMS.filter((item) => {
    const required = ROUTE_MODULE[item.href];
    return !required || enabledModules.includes(required);
  });

  return (
    <nav className={cn("flex flex-1 flex-col gap-1 px-3", rail && "[[data-sidebar=collapsed]_&]:px-2")}>
      {filteredNavItems.map((item) => {

        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={folded ? item.label : undefined}
            aria-label={folded ? item.label : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              rail && "[[data-sidebar=collapsed]_&]:justify-center [[data-sidebar=collapsed]_&]:px-0",
              active ? "text-brand-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-lg bg-brand shadow-sm"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <Icon className="relative z-10 size-[18px] shrink-0" />
            <span className={cn("relative z-10 truncate", rail && "[[data-sidebar=collapsed]_&]:hidden")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand({ rail = false }: { rail?: boolean }) {
  return <ProfileSwitcher rail={rail} />;
}

function FoldButton() {
  const folded = useSidebarCollapsed();
  // The shortcut's name depends on the platform: known only in the browser.
  const [shortcut, setShortcut] = useState("");
  useEffect(() => setShortcut(shortcutLabel(isMacPlatform())), []);
  const label = folded ? "Déplier la barre latérale" : "Réduire la barre latérale";
  return (
    <button
      type="button"
      onClick={() => setSidebarCollapsed(!folded)}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-expanded={!folded}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [[data-sidebar=collapsed]_&]:justify-center [[data-sidebar=collapsed]_&]:px-0"
    >
      {/* Both icons are drawn and the CSS shows one: right from the first paint, before React knows. */}
      <PanelLeftClose className="size-[18px] shrink-0 [[data-sidebar=collapsed]_&]:hidden" />
      <PanelLeftOpen className="hidden size-[18px] shrink-0 [[data-sidebar=collapsed]_&]:block" />
      <span className="flex-1 text-left [[data-sidebar=collapsed]_&]:hidden">Réduire</span>
      {shortcut && <kbd className="font-sans text-[10px] opacity-70 [[data-sidebar=collapsed]_&]:hidden">{shortcut}</kbd>}
    </button>
  );
}

/** Desktop rail: full width with labels, or folded to its icons (⌘B / Ctrl+B). */
export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur transition-[width] duration-200 lg:flex [[data-sidebar=collapsed]_&]:w-16">
      <SidebarBrand rail />
      <SidebarNav rail />
      <div className="space-y-1 px-3 py-3 [[data-sidebar=collapsed]_&]:px-2">
        <FoldButton />
        <p className="px-3 text-[11px] text-muted-foreground [[data-sidebar=collapsed]_&]:hidden">v2 · Next.js</p>
      </div>
    </aside>
  );
}
