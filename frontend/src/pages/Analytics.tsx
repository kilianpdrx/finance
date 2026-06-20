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
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts'

type Tab = 'categories' | 'tendances' | 'repartition' | 'flux' | 'patrimoine' | 'recurrents'

interface SpendingTrend {
  category_id: number | null
  category_name: string
  category_color: string
  category_account_id?: number | null
  series: Array<{ month: string; amount_cents: number }>
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'categories', label: 'Par catégorie' },
  { id: 'tendances', label: 'Tendances' },
  { id: 'repartition', label: 'Répartition mensuelle' },
  { id: 'flux', label: 'Flux de trésorerie' },
  { id: 'patrimoine', label: 'Patrimoine' },
  { id: 'recurrents', label: 'Récurrents' },
]

const MONTH_LABELS: Record<string, string> = {
  '01': 'Janvier', '02': 'Février', '03': 'Mars', '04': 'Avril',
  '05': 'Mai', '06': 'Juin', '07': 'Juillet', '08': 'Août',
  '09': 'Septembre', '10': 'Octobre', '11': 'Novembre', '12': 'Décembre',
}

import { formatCents, deriveCurrency, currencySymbol } from '../utils/currency'

export default function Analytics() {
  const { dateFrom, dateTo } = useDateRangeStore()
  const { accounts, setAccounts } = useAccountsStore()
  const [tab, setTab] = useState<Tab>('categories')
  const [byCategory, setByCategory] = useState<CategoryBreakdown[]>([])
  const [cashFlow, setCashFlow] = useState<CashFlowMonth[]>([])
  const [netWorth, setNetWorth] = useState<Record<string, unknown>[]>([])
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([])
  const [spendingTrends, setSpendingTrends] = useState<SpendingTrend[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAccountIds, setSelectedAccountIds] = useState<number[] | null>(null)
  // Use undefined = nothing expanded, null = uncategorized expanded, number = specific category
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null | undefined>(undefined)
  const [categoryTxns, setCategoryTxns] = useState<Transaction[]>([])
  const [categoryTxnsLoading, setCategoryTxnsLoading] = useState(false)
  const displayCurrency = deriveCurrency(accounts, selectedAccountIds)
  const sym = currencySymbol(displayCurrency)

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
      analytics.spendingTrends(range),
    ]).then(([bc, cf, nw, rec, trends]) => {
      setByCategory(bc)
      setCashFlow(cf)
      setNetWorth(nw)
      setRecurring(rec)
      setSpendingTrends(trends)
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
      uncategorized: categoryId === null ? true : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      is_debit: true,
      is_internal_transfer: false,
      account_id: selectedAccountIds?.length === 1 ? selectedAccountIds[0] : undefined,
      limit: 200,
    }).then(txns => {
      // If multiple accounts selected, filter client-side
      if (selectedAccountIds && selectedAccountIds.length > 1) {
        setCategoryTxns(txns.filter(t => selectedAccountIds.includes(t.account_id)))
      } else {
        setCategoryTxns(txns)
      }
    })
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
              <SpendingByCategory data={byCategory} currency={displayCurrency} />
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
                        <span className="font-medium text-red-500">{formatCents(b.total_cents, displayCurrency)}</span>
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
                                    {txn.is_debit ? '-' : '+'}{formatCents(txn.amount_cents, txn.currency || displayCurrency)}
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

          {tab === 'tendances' && (
            <div>
              <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">
                Tendances des dépenses par catégorie
              </h3>
              {spendingTrends.length === 0 ? (
                <p className="text-gray-400 dark:text-slate-500 text-sm text-center py-8">Aucune donnée disponible</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {spendingTrends.map((trend) => {
                    const chartData = trend.series.map(s => ({
                      month: s.month.slice(5), // "MM" from "YYYY-MM"
                      montant: s.amount_cents / 100,
                    }))
                    const maxVal = Math.max(...chartData.map(d => d.montant), 1)
                    return (
                      <div key={trend.category_id ?? 'none'} className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: trend.category_color }} />
                          <span className="text-sm font-medium text-gray-700 dark:text-slate-300 truncate">{trend.category_name}</span>
                          <span className="text-[10px] text-gray-400 dark:text-slate-500 flex-shrink-0">
                            {trend.category_account_id
                              ? accounts.find(a => a.id === trend.category_account_id)?.name ?? '?'
                              : 'Tous'}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto whitespace-nowrap">
                            {formatCents(trend.series.reduce((s, d) => s + d.amount_cents, 0), displayCurrency)}
                          </span>
                        </div>
                        <ResponsiveContainer width="100%" height={80}>
                          <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-slate-700" />
                            <XAxis dataKey="month" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                            <YAxis hide domain={[0, maxVal * 1.1]} />
                            <Tooltip
                              formatter={(value: number) => [`${value.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} ${sym}`, 'Dépenses']}
                              contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="montant"
                              stroke={trend.category_color}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 3 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'repartition' && (
            <div>
              <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">
                Répartition des dépenses par mois
              </h3>
              {(() => {
                // Pivot spending trends data by month
                const monthMap = new Map<string, Array<{ name: string; value: number; color: string }>>()
                for (const trend of spendingTrends) {
                  for (const s of trend.series) {
                    if (s.amount_cents === 0) continue
                    if (!monthMap.has(s.month)) monthMap.set(s.month, [])
                    monthMap.get(s.month)!.push({
                      name: trend.category_name,
                      value: s.amount_cents / 100,
                      color: trend.category_color,
                    })
                  }
                }
                const months = Array.from(monthMap.keys()).sort()
                if (months.length === 0) {
                  return <p className="text-gray-400 dark:text-slate-500 text-sm text-center py-8">Aucune donnée disponible</p>
                }
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {months.map((m) => {
                      const slices = monthMap.get(m)!.sort((a, b) => b.value - a.value)
                      const total = slices.reduce((s, d) => s + d.value, 0)
                      const [yr, mo] = m.split('-')
                      const label = `${MONTH_LABELS[mo] ?? mo} ${yr}`
                      return (
                        <div key={m} className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
                          <div className="flex items-center justify-between w-full mb-2">
                            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{label}</span>
                            <span className="text-xs font-medium text-gray-400 dark:text-slate-500">{formatCents(total * 100, displayCurrency)}</span>
                          </div>
                          <div className="flex items-center">
                            <div className="flex-shrink-0" style={{ width: 160, height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie
                                    data={slices}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={70}
                                    innerRadius={30}
                                    paddingAngle={1}
                                    strokeWidth={0}
                                  >
                                    {slices.map((entry, idx) => (
                                      <Cell key={idx} fill={entry.color} />
                                    ))}
                                  </Pie>
                                  <Tooltip
                                    formatter={(value: number, name: string) => [
                                      `${value.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} ${sym} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                                      name,
                                    ]}
                                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                  />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="flex-1 min-w-0 ml-2 space-y-0.5 overflow-hidden">
                              {slices.slice(0, 6).map((entry, idx) => {
                                const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0'
                                return (
                                  <div key={idx} className="flex items-center gap-1.5 text-xs">
                                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                                    <span className="truncate flex-1 min-w-0 text-gray-600 dark:text-slate-400">{entry.name}</span>
                                    <span className="flex-shrink-0 font-medium text-gray-700 dark:text-slate-300 text-right w-14">
                                      {entry.value.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} {sym}
                                    </span>
                                    <span className="flex-shrink-0 text-gray-400 dark:text-slate-500 text-right w-12">
                                      {pct}%
                                    </span>
                                  </div>
                                )
                              })}
                              {slices.length > 6 && (
                                <div className="text-xs text-gray-400 dark:text-slate-500 italic">
                                  +{slices.length - 6} autres
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          )}

          {tab === 'flux' && (
            <div>
              <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Flux de trésorerie mensuel</h3>
              <CashFlowOverTime data={cashFlow} currency={displayCurrency} />
            </div>
          )}

          {tab === 'patrimoine' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Évolution du patrimoine net</h3>
                <NetWorthEvolution data={netWorth} currency={displayCurrency} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">Répartition par compte</h3>
                <AccountBreakdown data={netWorth} currency={displayCurrency} />
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
                      <span className="text-red-500 font-medium text-sm">{formatCents(r.avg_amount_cents, displayCurrency)}</span>
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
