import { create } from "zustand";
import { persist } from "zustand/middleware";
import { format, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";

// ── Date range ──────────────────────────────────────────────────────────────
export type Preset =
  | "ce-mois"
  | "mois-dernier"
  | "3-mois"
  | "6-mois"
  | "1-an"
  | "cette-annee"
  | "tout"
  | "custom";

export const PRESET_LABELS: Record<Exclude<Preset, "custom">, string> = {
  "ce-mois": "Ce mois",
  "mois-dernier": "Mois dernier",
  "3-mois": "3 mois",
  "6-mois": "6 mois",
  "1-an": "1 an",
  "cette-annee": "Cette année",
  tout: "Tout",
};

function presetToDates(preset: Preset): { dateFrom: string; dateTo: string } {
  const today = new Date();
  switch (preset) {
    case "ce-mois":
      return { dateFrom: format(startOfMonth(today), "yyyy-MM-dd"), dateTo: format(endOfMonth(today), "yyyy-MM-dd") };
    case "mois-dernier": {
      const last = subMonths(today, 1);
      return { dateFrom: format(startOfMonth(last), "yyyy-MM-dd"), dateTo: format(endOfMonth(last), "yyyy-MM-dd") };
    }
    case "3-mois":
      return { dateFrom: format(subMonths(today, 3), "yyyy-MM-dd"), dateTo: format(today, "yyyy-MM-dd") };
    case "6-mois":
      return { dateFrom: format(subMonths(today, 6), "yyyy-MM-dd"), dateTo: format(today, "yyyy-MM-dd") };
    case "1-an":
      return { dateFrom: format(startOfMonth(subMonths(today, 12)), "yyyy-MM-dd"), dateTo: format(endOfMonth(today), "yyyy-MM-dd") };
    case "cette-annee":
      return { dateFrom: format(startOfYear(today), "yyyy-MM-dd"), dateTo: format(today, "yyyy-MM-dd") };
    default:
      return { dateFrom: "", dateTo: "" };
  }
}

interface DateRangeState {
  preset: Preset;
  dateFrom: string;
  dateTo: string;
  setPreset: (preset: Preset) => void;
  setCustomRange: (from: string, to: string) => void;
}

export const useDateRangeStore = create<DateRangeState>()(
  persist(
    (set) => {
      const initial = presetToDates("cette-annee");
      return {
        preset: "cette-annee",
        dateFrom: initial.dateFrom,
        dateTo: initial.dateTo,
        setPreset: (preset) => {
          const dates = presetToDates(preset);
          set({ preset, ...dates });
        },
        setCustomRange: (dateFrom, dateTo) => set({ preset: "custom", dateFrom, dateTo }),
      };
    },
    { name: "finance-date-range" },
  ),
);

// ── Selected accounts (null = all) ────────────────────────────────────────────
interface SelectedAccountsState {
  selectedAccountIds: number[] | null;
  setSelectedAccountIds: (ids: number[] | null) => void;
  toggleAccount: (id: number, allIds: number[]) => void;
}

export const useSelectedAccountsStore = create<SelectedAccountsState>()(
  persist(
    (set, get) => ({
      selectedAccountIds: null,
      setSelectedAccountIds: (ids) => set({ selectedAccountIds: ids }),
      toggleAccount: (id, allIds) => {
        const current = get().selectedAccountIds ?? allIds;
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        set({ selectedAccountIds: next.length === allIds.length ? null : next });
      },
    }),
    { name: "finance-selected-accounts" },
  ),
);

// ── Privacy mode (blur amounts) ───────────────────────────────────────────────
interface PrivacyState {
  hidden: boolean;
  toggle: () => void;
}

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set, get) => ({ hidden: false, toggle: () => set({ hidden: !get().hidden }) }),
    { name: "finance-privacy" },
  ),
);
