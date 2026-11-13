import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { format, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";

/** "01/06/2026 – 30/06/2026" for display; empty range → "Tout l'historique". */
export function rangeLabel(from: string, to: string): string {
  if (!from && !to) return "Tout l'historique";
  const fmt = (s: string) => (s ? format(new Date(s + "T00:00:00"), "dd/MM/yyyy") : "…");
  return `${fmt(from)} – ${fmt(to)}`;
}

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

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Preset ranges, all snapped to whole-month boundaries. */
export function presetToDates(preset: Preset): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const monthEnd = endOfMonth(today);
  switch (preset) {
    case "ce-mois":
      return { dateFrom: iso(startOfMonth(today)), dateTo: iso(monthEnd) };
    case "mois-dernier": {
      const last = subMonths(today, 1);
      return { dateFrom: iso(startOfMonth(last)), dateTo: iso(endOfMonth(last)) };
    }
    case "3-mois":
      return { dateFrom: iso(startOfMonth(subMonths(today, 2))), dateTo: iso(monthEnd) };
    case "6-mois":
      return { dateFrom: iso(startOfMonth(subMonths(today, 5))), dateTo: iso(monthEnd) };
    case "1-an":
      return { dateFrom: iso(startOfMonth(subMonths(today, 11))), dateTo: iso(monthEnd) };
    case "cette-annee":
      return { dateFrom: iso(startOfYear(today)), dateTo: iso(monthEnd) };
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

// ── Active profile ────────────────────────────────────────────────────────────
interface ProfileState {
  activeProfileId: number | null;
  setActiveProfile: (id: number) => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      activeProfileId: null,
      setActiveProfile: (id) => set({ activeProfileId: id }),
    }),
    { name: "finance-active-profile" },
  ),
);

/** Vanilla getter usable outside React (e.g. in the fetch interceptor). */
export function getActiveProfileId(): number | null {
  return useProfileStore.getState().activeProfileId;
}

// ── Profile unlock (PIN) ──────────────────────────────────────────────────────
// The tokens `POST /profiles/{id}/unlock` hands out, by profile id. Kept in
// sessionStorage: they survive a reload but not closing the tab, so a closed tab
// is a locked profile. `lockedId` is set when the API answers 401 with
// `X-Profile-Locked` (token expired, server restarted, PIN changed elsewhere).

/** sessionStorage that never throws: blocked storage only means asking again. */
const safeSessionStorage: StateStorage = {
  getItem: (name) => {
    try { return window.sessionStorage.getItem(name); } catch { return null; }
  },
  setItem: (name, value) => {
    try { window.sessionStorage.setItem(name, value); } catch { /* kept in memory only */ }
  },
  removeItem: (name) => {
    try { window.sessionStorage.removeItem(name); } catch { /* nothing to remove */ }
  },
};

function withoutToken(tokens: Record<string, string>, id: number): Record<string, string> {
  const next = { ...tokens };
  delete next[String(id)];
  return next;
}

interface ProfileUnlockState {
  tokens: Record<string, string>;
  lockedId: number | null;
  setToken: (id: number, token: string) => void;
  clearToken: (id: number) => void;
  markLocked: (id: number) => void;
}

export const useProfileUnlockStore = create<ProfileUnlockState>()(
  persist(
    (set) => ({
      tokens: {},
      lockedId: null,
      setToken: (id, token) => set((s) => ({
        tokens: { ...s.tokens, [String(id)]: token },
        lockedId: s.lockedId === id ? null : s.lockedId,
      })),
      clearToken: (id) => set((s) => ({ tokens: withoutToken(s.tokens, id) })),
      markLocked: (id) => set((s) => ({ tokens: withoutToken(s.tokens, id), lockedId: id })),
    }),
    {
      name: "finance-profile-unlock",
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: (s) => ({ tokens: s.tokens }),
    },
  ),
);

/** Vanilla getter for the fetch interceptor. */
export function getUnlockToken(id: number | null): string | null {
  if (id == null) return null;
  return useProfileUnlockStore.getState().tokens[String(id)] ?? null;
}

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

// ── Dismissed hints ───────────────────────────────────────────────────────────
// One-off notices the user closed. The id carries whatever the hint is about
// (profile, currency…), so it comes back if that changes.
interface HintsState {
  dismissed: string[];
  dismiss: (id: string) => void;
}

export const useHintsStore = create<HintsState>()(
  persist(
    (set, get) => ({
      dismissed: [],
      dismiss: (id) => set({ dismissed: [...new Set([...get().dismissed, id])] }),
    }),
    { name: "finance-hints" },
  ),
);
