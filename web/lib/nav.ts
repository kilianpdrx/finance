import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  ChartPie,
  Landmark,
  TrendingUp,
  Upload,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Sidebar order per project convention. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/budget", label: "Budget", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/analyses", label: "Analyse des dépenses", icon: ChartPie },
  { href: "/comptes", label: "Comptes", icon: Landmark },
  { href: "/investissements", label: "Investissements", icon: TrendingUp },
  { href: "/importer", label: "Importer", icon: Upload },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];
