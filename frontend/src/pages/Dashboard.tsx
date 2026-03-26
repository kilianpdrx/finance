import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useDateRangeStore, useAccountsStore, useSelectedAccountsStore } from '../store'
import { analytics, accounts as accApi } from '../api/client'
import type { AnalyticsSummary, CashFlowMonth, CategoryBreakdown } from '../types'
import SpendingByCategory from '../components/charts/SpendingByCategory'
import CashFlowOverTime from '../components/charts/CashFlowOverTime'
import NetWorthEvolution from '../components/charts/NetWorthEvolution'
import AccountFilter from '../components/AccountFilter'

interface KpiCardProps {
  label: string
  value: string
  subtitle?: string
  color?: string
  icon: React.ReactNode
}

function KpiCard({ label, value, subtitle, color = 'text-gray-900 dark:text-white', icon }: KpiCardProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
      <div className="p-3 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {subtitle && <p className="text-sm text-gray-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5">
      <h3 className="text-base font-semibold text-gray-700 dark:text-slate-300 mb-4">{title}</h3>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const { dateFrom, dateTo } = useDateRangeStore()
  const { accounts, setAccounts } = useAccountsStore()
  const { selectedAccountIds, setSelectedAccountIds, toggleAccount } = useSelectedAccountsStore()
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [cashFlow, setCashFlow] = useState<CashFlowMonth[]>([])
  const [byCategory, setByCategory] = useState<CategoryBreakdown[]>([])
  const [netWorth, setNetWorth] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

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
      analytics.summary(range),
      analytics.cashFlow(range),
      analytics.byCategory(range),
      analytics.netWorth(range),
    ]).then(([s, cf, bc, nw]) => {
      setSummary(s)
      setCashFlow(cf)
      setByCategory(bc)
      setNetWorth(nw)
    }).catch(console.error).finally(() => setLoading(false))
  }, [dateFrom, dateTo, selectedAccountIds])

  const handleSelectAll = () => {
    setSelectedAccountIds(null)
  }

  const handleToggleAccount = (id: number) => {
    toggleAccount(id, accounts.map(a => a.id))
  }

  const lastDateDisplay = summary?.last_transaction_date
    ? format(parseISO(summary.last_transaction_date), 'dd/MM/yyyy', { locale: fr })
    : null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Tableau de bord</h2>
          {lastDateDisplay && (
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
              Dernière transaction : <span className="font-medium text-gray-600 dark:text-slate-300">{lastDateDisplay}</span>
            </p>
          )}
        </div>
        {accounts.length > 0 && (
          <AccountFilter
            accounts={accounts}
            selectedIds={selectedAccountIds}
            onToggle={handleToggleAccount}
            onSelectAll={handleSelectAll}
          />
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Revenus"
          value={summary?.total_income_display ?? '—'}
          color="text-green-600 dark:text-green-400"
          icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>}
        />
        <KpiCard
          label="Dépenses"
          value={summary?.total_expenses_display ?? '—'}
          color="text-red-600 dark:text-red-400"
          icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" /></svg>}
        />
        <KpiCard
          label="Flux net"
          value={summary?.net_cash_flow_display ?? '—'}
          color={(summary?.net_cash_flow_cents ?? 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
          icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
        />
        <KpiCard
          label="Patrimoine net"
          value={summary?.net_worth_display ?? '—'}
          color="text-emerald-600 dark:text-emerald-400"
          icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Dépenses par catégorie">
          <SpendingByCategory data={byCategory} />
        </ChartCard>
        <ChartCard title="Flux de trésorerie mensuel">
          <CashFlowOverTime data={cashFlow} />
        </ChartCard>
      </div>

      <ChartCard title="Évolution du patrimoine net">
        <NetWorthEvolution data={netWorth} />
      </ChartCard>
    </div>
  )
}
