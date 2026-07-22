"use client";

import { usePathname } from "next/navigation";
import { Menu, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { QuitButton } from "./quit-button";
import { DateRangePicker } from "./date-range-picker";
import { NAV_ITEMS } from "@/lib/nav";
import { usePrivacyStore } from "@/lib/stores";

function pageTitle(pathname: string) {
  if (pathname === "/") return "Tableau de bord";
  const match = NAV_ITEMS.find((i) => i.href !== "/" && pathname.startsWith(i.href));
  return match?.label ?? "Finance";
}

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const { hidden, toggle } = usePrivacyStore();

  // Period picker lives only where the date range actually drives the data.
  const showPeriod = pathname === "/" || pathname.startsWith("/analyses");

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Menu">
        <Menu className="size-5" />
      </Button>

      <h1 className="text-base font-semibold tracking-tight sm:text-lg">{pageTitle(pathname)}</h1>

      <div className="ml-auto flex items-center gap-2">
        {showPeriod && <DateRangePicker />}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={hidden ? "Afficher les montants" : "Masquer les montants"}
        >
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <ThemeToggle />
        <QuitButton />
      </div>
    </header>
  );
}
