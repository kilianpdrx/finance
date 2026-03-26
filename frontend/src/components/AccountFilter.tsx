import { useState } from 'react'
import type { Account } from '../types'

interface Props {
  accounts: Account[]
  selectedIds: number[] | null
  onToggle: (id: number) => void
  onSelectAll: () => void
}

export default function AccountFilter({ accounts, selectedIds, onToggle, onSelectAll }: Props) {
  const [open, setOpen] = useState(false)
  const effectiveSelected = selectedIds ?? accounts.map(a => a.id)
  const allSelected = selectedIds === null || effectiveSelected.length === accounts.length

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:border-emerald-400 transition-colors w-48 focus-ring"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
          <span className="truncate">
            {allSelected ? 'Tous les comptes' : `${effectiveSelected.length} compte${effectiveSelected.length > 1 ? 's' : ''}`}
          </span>
        </div>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1 min-w-52">
          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onSelectAll}
              className="rounded text-emerald-600"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Tous les comptes</span>
          </label>
          <div className="border-t border-gray-100 dark:border-slate-700 my-1" />
          {accounts.map((acc) => (
            <label key={acc.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={effectiveSelected.includes(acc.id)}
                onChange={() => onToggle(acc.id)}
                className="rounded text-emerald-600"
              />
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: acc.color }} />
              <span className="text-sm text-gray-700 dark:text-gray-200">{acc.name}</span>
              <span className="text-xs text-gray-400 dark:text-slate-500">{acc.bank_name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
