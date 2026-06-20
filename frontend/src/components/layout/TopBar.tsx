import { useDateRangeStore, useThemeStore } from '../../store'

const PRESETS = [
  { value: 'ce-mois', label: 'Ce mois' },
  { value: 'mois-dernier', label: 'Mois dernier' },
  { value: '3-mois', label: '3 mois' },
  { value: '6-mois', label: '6 mois' },
  { value: '1-an', label: 'Sur un an' },
  { value: 'cette-annee', label: 'Cette année' },
  { value: 'tout', label: 'Tout' },
] as const

export default function TopBar() {
  const { preset, dateFrom, dateTo, setPreset, setCustomRange } = useDateRangeStore()
  const { isDark, toggle } = useThemeStore()

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>

        <div className="flex bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5 gap-0.5 overflow-x-auto scrollbar-hide">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`px-4 py-2 text-sm font-bold rounded-lg transition-all whitespace-nowrap focus-ring ${
                preset === p.value
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setPreset('custom')}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-all whitespace-nowrap focus-ring ${
              preset === 'custom'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            Personnalisé
          </button>
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setCustomRange(e.target.value, dateTo)}
              aria-label="Date de début"
              className="border border-emerald-300 dark:border-emerald-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-xs focus-ring"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setCustomRange(dateFrom, e.target.value)}
              aria-label="Date de fin"
              className="border border-emerald-300 dark:border-emerald-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 text-xs focus-ring"
            />
          </div>
        )}
      </div>

      <button
        onClick={toggle}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors focus-ring"
        aria-label="Basculer le thème"
      >
        {isDark ? (
          <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        )}
      </button>
    </header>
  )
}
