import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  ChartPie,
  Landmark,
  TrendingUp,
  Upload,
  Settings,
  Target,
  BadgeMinus,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Modules a profile has by default (used as a fallback while the profile loads). */
export const DEFAULT_MODULES = ["banking", "budgeting", "investments", "goals", "loans"];

/** Which enabled-module a route requires (absent = always visible). */
export const ROUTE_MODULE: Record<string, string> = {
  "/investissements": "investments",
  "/budget": "budgeting",
  "/objectifs": "goals",
  "/emprunts": "loans",
};

/** Sidebar order per project convention. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analyses", label: "Analyses", icon: ChartPie },
  { href: "/comptes", label: "Comptes", icon: Landmark },
  { href: "/objectifs", label: "Objectifs", icon: Target },
  { href: "/emprunts", label: "Emprunts", icon: BadgeMinus },
  { href: "/investissements", label: "Investissements", icon: TrendingUp },
  { href: "/importer", label: "Importer", icon: Upload },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];
