import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { useDateRangeStore, useAccountsStore } from '../store'
import { analytics, accounts as accApi, transactions as txnApi } from '../api/client'
import type { CashFlowMonth, CategoryBreakdown, RecurringTransaction, Account, Transaction } from '../types'
import SpendingByCategory from '../components/charts/SpendingByCategory'
import CashFlowOverTime from '../components/charts/CashFlowOverTime'
import NetWorthEvolution from '../components/charts/NetWorthEvolution'
import AccountBreakdown from '../components/charts/AccountBreakdown'
import AccountFilter from '../components/AccountFilter'

type Tab = 'categories' | 'flux' | 'patrimoine' | 'recurrents'

const TABS: { id: Tab; label: string }[] = [
  { id: 'categories', label: 'Par catégorie' },
  { id: 'flux', label: 'Flux de trésorerie' },
  { id: 'patrimoine', label: 'Patrimoine' },
  { id: 'recurrents', label: 'Récurrents' },
]

function centsToEur(cents: number): string {
  return `${(Math.abs(cents) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`
}

export default function Analytics() {
  const { dateFrom, dateTo } = useDateRangeStore()
  const { accounts, setAccounts } = useAccountsStore()
  const [tab, setTab] = useState<Tab>('categories')
  const [byCategory, setByCategory] = useState<CategoryBreakdown[]>([])
  const [cashFlow, setCashFlow] = useState<CashFlowMonth[]>([])
  const [netWorth, setNetWorth] = useState<Record<string, unknown>[]>([])
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[] | null>(null)
  // Use undefined = nothing expanded, null = uncategorized expanded, number = specific category
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null | undefined>(undefined)
  const [categoryTxns, setCategoryTxns] = useState<Transaction[]>([])
  const [categoryTxnsLoading, setCategoryTxnsLoading] = useState(false)

  useEffect(() => {
    if (!accounts.length) {
      accApi.list().then(setAccounts).catch(console.error)
    }
  }, [])

  useEffect(() => {
    const range = {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      account_ids: selectedAccountIds ?? undefined,
    }
    setLoading(true)
    Promise.all([
      analytics.byCategory(range),
      analytics.cashFlow(range),
      analytics.netWorth(range),
      analytics.recurring(selectedAccountIds ?? undefined),
    ]).then(([bc, cf, nw, rec]) => {
      setByCategory(bc)
      setCashFlow(cf)
      setNetWorth(nw)
      setRecurring(rec)
    }).catch(console.error).finally(() => setLoading(false))
  }, [dateFrom, dateTo, selectedAccountIds])

  // Reset expanded category when filters change
  useEffect(() => {
    setExpandedCategoryId(undefined)
    setCategoryTxns([])
  }, [dateFrom, dateTo, selectedAccountIds])

  const handleCategoryClick = (categoryId: number | null) => {
    if (expandedCategoryId !== undefined && expandedCategoryId === categoryId) {
      setExpandedCategoryId(undefined)
      setCategoryTxns([])
      return
    }
    setExpandedCategoryId(categoryId)
    setCategoryTxnsLoading(true)
    txnApi.list({
      category_id: categoryId ?? undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: 50,
    }).then(setCategoryTxns)
      .catch(console.error)
      .finally(() => setCategoryTxnsLoading(false))
  }

  const handleToggleAccount = (id: number) => {
    const allIds = accounts.map(a => a.id)
    const current = selectedAccountIds ?? allIds
    const updated = current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    if (updated.length === allIds.length) {
      setSelectedAccountIds(null)
    } else {
      setSelectedAccountIds(updated)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Analyses</h2>
        {accounts.length > 0 && (
          <AccountFilter
            accounts={accounts}
            selectedIds={selectedAccountIds}
            onToggle={handleToggleAccount}
            onSelectAll={() => setSelectedAccountIds(null)}
          />
        )}
      </div>

      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus-ring ${
              tab === t.id
                ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-6">
          {tab === 'categories' && (
            <div>
              <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Dépenses par catégorie</h3>
              <SpendingByCategory data={byCategory} />
              <div className="mt-4 space-y-1">
                {byCategory.map((b) => (
                  <div key={b.category_id ?? 'none'}>
                    <div
                      onClick={() => handleCategoryClick(b.category_id)}
                      className="flex items-center justify-between text-sm py-1.5 px-2 rounded-md cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                    >
                      <span className="text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
                        <span className="text-xs text-gray-400 dark:text-slate-500 w-4">
                          {expandedCategoryId !== undefined && expandedCategoryId === b.category_id ? '▼' : '▶'}
                        </span>
                        {b.category_name}
                      </span>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-500 dark:text-slate-400">{b.count} opération{b.count !== 1 ? 's' : ''}</span>
                        <span className="font-medium text-red-500">{centsToEur(b.total_cents)}</span>
                        <span className="text-gray-400 dark:text-slate-500 w-10 text-right">{b.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                    {expandedCategoryId !== undefined && expandedCategoryId === b.category_id && (
                      <div className="ml-6 mt-1 mb-3">
                        {categoryTxnsLoading ? (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500" />
                          </div>
                        ) : categoryTxns.length === 0 ? (
                          <p className="text-gray-400 dark:text-slate-500 text-sm py-3 text-center">Aucune transaction trouvée</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                                <th className="py-1.5 font-medium">Date</th>
                                <th className="py-1.5 font-medium">Description</th>
                                <th className="py-1.5 font-medium text-right">Montant</th>
                                <th className="py-1.5 font-medium text-right">Compte</th>
                              </tr>
                            </thead>
                            <tbody>
                              {categoryTxns.map((txn) => (
                                <tr key={txn.id} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
                                  <td className="py-1.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">
                                    {format(new Date(txn.date), 'dd/MM/yyyy')}
                                  </td>
                                  <td className="py-1.5 text-gray-700 dark:text-slate-300 truncate max-w-xs">
                                    {txn.description}
                                  </td>
                                  <td className={`py-1.5 text-right font-medium whitespace-nowrap ${txn.is_debit ? 'text-red-500' : 'text-emerald-500'}`}>
                                    {txn.is_debit ? '-' : '+'}{centsToEur(txn.amount_cents)}
                                  </td>
                                  <td className="py-1.5 text-right text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                    {txn.account_name ?? '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'flux' && (
            <div>
              <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Flux de trésorerie mensuel</h3>
              <CashFlowOverTime data={cashFlow} />
            </div>
          )}

          {tab === 'patrimoine' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Évolution du patrimoine net</h3>
                <NetWorthEvolution data={netWorth} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Répartition par compte</h3>
                <AccountBreakdown data={netWorth} />
              </div>
            </div>
          )}

          {tab === 'recurrents' && (
            <div>
              <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">
                Transactions récurrentes ({recurring.length})
              </h3>
              {recurring.length === 0 ? (
                <p className="text-gray-400 dark:text-slate-500 text-sm text-center py-8">Aucune transaction récurrente détectée</p>
              ) : (
                <div className="space-y-2">
                  {recurring.map((r, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-slate-800">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white text-sm">{r.description}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">
                          {r.occurrences} fois · dernière le {r.last_date}
                        </p>
                      </div>
                      <span className="text-red-500 font-medium text-sm">{centsToEur(r.avg_amount_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
