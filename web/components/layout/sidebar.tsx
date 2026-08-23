"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { NAV_ITEMS, DEFAULT_MODULES, ROUTE_MODULE } from "@/lib/nav";
import { ProfileSwitcher } from "@/components/profiles/profile-switcher";
import { useActiveProfile } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeProfile = useActiveProfile();
  const enabledModules = activeProfile?.enabled_modules ?? DEFAULT_MODULES;

  const filteredNavItems = NAV_ITEMS.filter((item) => {
    const required = ROUTE_MODULE[item.href];
    return !required || enabledModules.includes(required);
  });

  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {filteredNavItems.map((item) => {

        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
            <span className="relative z-10">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return <ProfileSwitcher />;
}

/** Desktop fixed rail. */
export function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur lg:flex">
      <SidebarBrand />
      <SidebarNav />
      <div className="px-5 py-4 text-[11px] text-muted-foreground">v2 · Next.js</div>
    </aside>
  );
}
