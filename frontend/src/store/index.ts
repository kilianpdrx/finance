import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { format, startOfMonth, endOfMonth, subMonths, startOfYear } from 'date-fns'
import type { Account } from '../types'

type Preset = 'ce-mois' | 'mois-dernier' | '3-mois' | '6-mois' | 'cette-annee' | 'tout' | 'custom'

function presetToDates(preset: Preset): { dateFrom: string; dateTo: string } {
  const today = new Date()
  switch (preset) {
    case 'ce-mois':
      return {
        dateFrom: format(startOfMonth(today), 'yyyy-MM-dd'),
        dateTo: format(endOfMonth(today), 'yyyy-MM-dd'),
      }
    case 'mois-dernier': {
      const last = subMonths(today, 1)
      return {
        dateFrom: format(startOfMonth(last), 'yyyy-MM-dd'),
        dateTo: format(endOfMonth(last), 'yyyy-MM-dd'),
      }
    }
    case '3-mois':
      return {
        dateFrom: format(subMonths(today, 3), 'yyyy-MM-dd'),
        dateTo: format(today, 'yyyy-MM-dd'),
      }
    case '6-mois':
      return {
        dateFrom: format(subMonths(today, 6), 'yyyy-MM-dd'),
        dateTo: format(today, 'yyyy-MM-dd'),
      }
    case 'cette-annee':
      return {
        dateFrom: format(startOfYear(today), 'yyyy-MM-dd'),
        dateTo: format(today, 'yyyy-MM-dd'),
      }
    case 'tout':
      return { dateFrom: '', dateTo: '' }
    default:
      return { dateFrom: '', dateTo: '' }
  }
}

interface DateRangeState {
  preset: Preset
  dateFrom: string
  dateTo: string
  setPreset: (preset: Preset) => void
  setCustomRange: (from: string, to: string) => void
}

export const useDateRangeStore = create<DateRangeState>((set) => {
  const initial = presetToDates('cette-annee')
  return {
    preset: 'cette-annee',
    dateFrom: initial.dateFrom,
    dateTo: initial.dateTo,
    setPreset: (preset) => {
      const dates = presetToDates(preset)
      set({ preset, dateFrom: dates.dateFrom, dateTo: dates.dateTo })
    },
    setCustomRange: (dateFrom, dateTo) => set({ preset: 'custom', dateFrom, dateTo }),
  }
})

// ── Theme ─────────────────────────────────────────────────────────────────────

interface ThemeState {
  isDark: boolean
  toggle: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      isDark: true,
      toggle: () => {
        const next = !get().isDark
        document.documentElement.classList.toggle('dark', next)
        set({ isDark: next })
      },
    }),
    { name: 'finance-theme' },
  ),
)

// ── Accounts cache ────────────────────────────────────────────────────────────

interface AccountsState {
  accounts: Account[]
  setAccounts: (accounts: Account[]) => void
}

export const useAccountsStore = create<AccountsState>((set) => ({
  accounts: [],
  setAccounts: (accounts) => set({ accounts }),
}))

// ── Selected accounts filter (persisted) ──────────────────────────────────────

interface SelectedAccountsState {
  // null means "all accounts selected"
  selectedAccountIds: number[] | null
  setSelectedAccountIds: (ids: number[] | null) => void
  toggleAccount: (id: number, allIds: number[]) => void
}

export const useSelectedAccountsStore = create<SelectedAccountsState>()(
  persist(
    (set, get) => ({
      selectedAccountIds: null,
      setSelectedAccountIds: (ids) => set({ selectedAccountIds: ids }),
      toggleAccount: (id, allIds) => {
        const current = get().selectedAccountIds ?? allIds
        const next = current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id]
        // If all selected, use null (= all)
        set({ selectedAccountIds: next.length === allIds.length ? null : next })
      },
    }),
    { name: 'finance-selected-accounts' },
  ),
)
