import { useEffect, useState } from 'react'
import { accounts as accApi, analytics } from '../api/client'
import type { Account } from '../types'
import NetWorthEvolution from '../components/charts/NetWorthEvolution'

function centsToDisplay(cents: number, currency = 'EUR'): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const formatted = (abs / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${sign}${formatted} ${currency}`
}

export default function Investments() {
  const [investAccounts, setInvestAccounts] = useState<Account[]>([])
  const [balances, setBalances] = useState<Record<number, number>>({})
  const [netWorth, setNetWorth] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [accsData, nw] = await Promise.all([
          accApi.list(),
          analytics.netWorth(),
        ])
        
        const invs = accsData.filter(a => a.account_type === 'investissement')
        setInvestAccounts(invs)
        
        // Filter net worth data to only include investment accounts
        const invNetWorth = nw.map(entry => {
          const newEntry: Record<string, unknown> = { month: entry.month, total: 0 }
          let total = 0
          for (const acc of invs) {
            if (entry[acc.name] !== undefined) {
              newEntry[acc.name] = entry[acc.name]
              total += entry[acc.name] as number
            }
          }
          newEntry.total = total
          return newEntry
        })
        setNetWorth(invNetWorth)
        
        if (nw.length > 0) {
          const last = nw[nw.length - 1]
          const balanceMap: Record<number, number> = {}
          invs.forEach((acc) => {
            const val = last[acc.name + '_native'] ?? last[acc.name]
            if (typeof val === 'number') {
              balanceMap[acc.id] = val
            }
          })
          setBalances(balanceMap)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalInvested = Object.values(balances).reduce((s, v) => s + v, 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Investissements</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Total investi : <span className="font-semibold text-emerald-600 dark:text-emerald-400">{centsToDisplay(totalInvested)}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {investAccounts.map((acc) => (
          <div
            key={acc.id}
            className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                  style={{ backgroundColor: acc.color }}
                >
                  {acc.name[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">{acc.name}</p>
                  <p className="text-xs text-gray-500">{acc.bank_name}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">
                {acc.account_type.charAt(0).toUpperCase() + acc.account_type.slice(1)}
              </span>
              {balances[acc.id] !== undefined && (
                <span className={`text-sm font-bold ${balances[acc.id] >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-500'}`}>
                  {centsToDisplay(balances[acc.id], acc.currency)}
                </span>
              )}
            </div>
          </div>
        ))}
        {investAccounts.length === 0 && (
          <div className="col-span-3 text-center text-gray-400 py-12 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700">
            Aucun compte d'investissement. Créez-en un dans la page Comptes.
          </div>
        )}
      </div>

      {netWorth.length > 0 && investAccounts.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Évolution des investissements</h3>
          <NetWorthEvolution data={netWorth} />
        </div>
      )}
    </div>
  )
}
