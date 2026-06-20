import { useEffect, useState, useCallback } from 'react'
import { investments as invApi, snapshots, type InvestmentAccount, type InvestmentSeriesPoint } from '../api/client'
import { formatCents, currencySymbol } from '../utils/currency'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts'

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

function fmtMonth(m: string) {
  const [y, mo] = m.split('-')
  return `${MONTHS_FR[parseInt(mo) - 1]} ${y}`
}

function PctBadge({ value, amountCents, currency }: { value: number | null; amountCents?: number | null; currency?: string }) {
  if (value === null || value === undefined) return <span className="text-xs text-gray-400">—</span>
  const positive = value >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-md ${
      positive
        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
        : 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40'
    }`}>
      {positive ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
      {amountCents != null && (
        <span className="opacity-75">{positive ? '+' : ''}{formatCents(amountCents, currency)}</span>
      )}
    </span>
  )
}

function MiniSparkline({ data, color }: { data: { v: number }[]; color: string }) {
  if (data.length < 2) return null
  return (
    <div className="w-24 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface AddFormState {
  date: string
  amount: string
  contribution: string
  notes: string
}

function AccountRow({ acc, onRefresh }: { acc: InvestmentAccount; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm] = useState<AddFormState>({
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    contribution: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const sparkData = acc.monthly.map(m => ({ v: m.amount_cents / 100 }))

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const amountNum = parseFloat(form.amount.replace(',', '.'))
    if (isNaN(amountNum)) return
    const contribNum = form.contribution ? parseFloat(form.contribution.replace(',', '.')) : 0
    setSaving(true)
    try {
      await snapshots.create(acc.id, {
        date: form.date,
        amount_cents: Math.round(amountNum * 100),
        contribution_cents: Math.round(contribNum * 100),
        currency: acc.currency,
        notes: form.notes || undefined,
      })
      setForm({ date: new Date().toISOString().slice(0, 10), amount: '', contribution: '', notes: '' })
      onRefresh()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSnap(snapId: number) {
    await snapshots.delete(acc.id, snapId)
    onRefresh()
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors text-left"
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: acc.color }}
        >
          {acc.name[0]?.toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 dark:text-white truncate">{acc.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{acc.bank_name}</p>
        </div>

        <MiniSparkline data={sparkData} color={acc.color} />

        <div className="text-right shrink-0">
          <PctBadge value={acc.perf_pct_from_last_month} amountCents={acc.perf_from_last_month_cents} currency={acc.currency} />
          <p className="text-[10px] text-gray-400 mt-0.5">perf. ce mois</p>
        </div>

        <div className="text-right shrink-0">
          <PctBadge value={acc.perf_pct_from_start} amountCents={acc.perf_from_start_cents} currency={acc.currency} />
          <p className="text-[10px] text-gray-400 mt-0.5">perf. totale</p>
        </div>

        <div className="text-right shrink-0 w-32">
          <p className="font-bold text-gray-900 dark:text-white text-sm">
            {acc.current_value_cents !== null ? formatCents(acc.current_value_cents, acc.currency) : '—'}
          </p>
        </div>

        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-slate-700 px-5 py-4 space-y-4">
          <form onSubmit={handleAdd} className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Valeur totale ({currencySymbol(acc.currency)})
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="12 500,00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white w-36"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Versement ({currencySymbol(acc.currency)})
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={form.contribution}
                onChange={e => setForm(f => ({ ...f, contribution: e.target.value }))}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white w-28"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Notes</label>
              <input
                type="text"
                placeholder="Optionnel"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white w-full"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !form.amount}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? '…' : 'Ajouter'}
            </button>
          </form>

          {acc.monthly.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-700">
                    <th className="text-left py-2 font-medium">Date</th>
                    <th className="text-right py-2 font-medium">Valeur</th>
                    <th className="text-right py-2 font-medium">Versement</th>
                    <th className="text-right py-2 font-medium">Évolution</th>
                    <th className="text-right py-2 font-medium">Performance</th>
                    <th className="text-left py-2 font-medium pl-4">Notes</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...acc.monthly].reverse().map((entry, idx, arr) => {
                    const prevEntry = arr[idx + 1]
                    let pctChange: number | null = null
                    let perfCents: number | null = null
                    let perfPct: number | null = null
                    if (prevEntry && prevEntry.amount_cents !== 0) {
                      const rawChange = entry.amount_cents - prevEntry.amount_cents
                      pctChange = (rawChange / Math.abs(prevEntry.amount_cents)) * 100
                      const marketReturn = rawChange - (entry.contribution_cents || 0)
                      perfCents = marketReturn
                      perfPct = (marketReturn / Math.abs(prevEntry.amount_cents)) * 100
                    }
                    const dateObj = new Date(entry.date + 'T00:00:00')
                    const dateStr = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
                    return (
                      <tr key={entry.id} className="border-b border-gray-50 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/30">
                        <td className="py-2 text-gray-900 dark:text-white">{dateStr}</td>
                        <td className="py-2 text-right font-medium text-gray-900 dark:text-white">
                          {formatCents(entry.amount_cents, entry.currency)}
                        </td>
                        <td className="py-2 text-right text-gray-500 dark:text-gray-400">
                          {entry.contribution_cents ? formatCents(entry.contribution_cents, entry.currency) : '—'}
                        </td>
                        <td className="py-2 text-right">
                          <PctBadge value={pctChange !== null ? Math.round(pctChange * 10) / 10 : null} />
                        </td>
                        <td className="py-2 text-right">
                          <PctBadge
                            value={perfPct !== null ? Math.round(perfPct * 10) / 10 : null}
                            amountCents={perfCents}
                            currency={entry.currency}
                          />
                        </td>
                        <td className="py-2 pl-4 text-gray-500 dark:text-gray-400 text-xs">{entry.notes || ''}</td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleDeleteSnap(entry.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            title="Supprimer"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Investments() {
  const [accounts, setAccounts] = useState<InvestmentAccount[]>([])
  const [series, setSeries] = useState<InvestmentSeriesPoint[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [accs, ser] = await Promise.all([
        invApi.accounts(),
        invApi.totalSeries(),
      ])
      setAccounts(accs)
      setSeries(ser)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const totalCurrent = accounts.reduce((s, a) => s + (a.current_value_cents ?? 0), 0)
  const totalPerfCents = accounts.reduce((s, a) => s + (a.perf_from_start_cents ?? 0), 0)
  const totalFirst = accounts.reduce((s, a) => s + (a.first_value_cents ?? 0), 0)
  const totalPerfPct = totalFirst !== 0 ? (totalPerfCents / Math.abs(totalFirst)) * 100 : null

  const chartData = series.map(s => ({
    month: fmtMonth(s.month),
    total: Math.round(s.total_cents / 100),
  }))

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
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
            Total :
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {formatCents(totalCurrent)}
            </span>
            {totalPerfPct !== null && (
              <PctBadge value={Math.round(totalPerfPct * 10) / 10} amountCents={totalPerfCents} />
            )}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {accounts.map(acc => (
          <AccountRow key={acc.id} acc={acc} onRefresh={load} />
        ))}
        {accounts.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 py-16 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700">
            <p className="text-lg mb-1">Aucun compte d'investissement</p>
            <p className="text-sm">Créez-en un dans la page Comptes avec le type « Investissement ».</p>
          </div>
        )}
      </div>

      {chartData.length >= 2 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Évolution globale des investissements
          </h3>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="invGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis
                tickFormatter={(v) => `${v.toLocaleString('fr-FR')} €`}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
              />
              <Tooltip
                formatter={(value: number) => [`${value.toLocaleString('fr-FR')} €`, 'Total investi']}
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#f1f5f9',
                }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#invGradient)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
