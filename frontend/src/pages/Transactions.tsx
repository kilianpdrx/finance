import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useDateRangeStore, useAccountsStore } from '../store'
import { transactions as txnApi, categories as catApi, accounts as accApi } from '../api/client'
import type { Transaction, Category } from '../types'
import TransactionTable from '../components/tables/TransactionTable'
import { format, parse, startOfMonth, endOfMonth, subMonths, addMonths } from 'date-fns'
import { fr } from 'date-fns/locale'

export default function Transactions() {
  const { dateFrom, dateTo } = useDateRangeStore()
  const { accounts, setAccounts } = useAccountsStore()
  const [txns, setTxns] = useState<Transaction[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null) // "YYYY-MM" or null for all

  // Creation Modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [formDate, setFormDate] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formAccountId, setFormAccountId] = useState('')
  const [formCategoryId, setFormCategoryId] = useState('')
  const [formIsDebit, setFormIsDebit] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(() => {
    setLoading(true)
    txnApi.list({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: 5000,
    })
      .then(setTxns)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo])

  useEffect(() => {
    catApi.list().then(setCats).catch(console.error)
    if (!accounts.length) {
      accApi.list().then(setAccounts).catch(console.error)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Build timeline months from available transactions
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>()
    for (const txn of txns) {
      if (txn.date) monthSet.add(txn.date.slice(0, 7))
    }
    return Array.from(monthSet).sort()
  }, [txns])

  // Filter transactions by selected month
  const filteredTxns = useMemo(() => {
    if (!selectedMonth) return txns
    return txns.filter(t => t.date?.startsWith(selectedMonth))
  }, [txns, selectedMonth])

  const timelineRef = useRef<HTMLDivElement>(null)

  const exportUrl = txnApi.exportUrl({
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formDate || !formDesc || !formAmount || !formAccountId) return
    setSaving(true)
    try {
      const cents = Math.round(parseFloat(formAmount.replace(',', '.')) * 100)
      await txnApi.create({
        date: formDate,
        description: formDesc,
        amount_cents: cents,
        account_id: parseInt(formAccountId),
        category_id: formCategoryId ? parseInt(formCategoryId) : null,
        is_debit: formIsDebit,
      })
      setIsModalOpen(false)
      loadData()

      setFormDate('')
      setFormDesc('')
      setFormAmount('')
      setFormAccountId('')
      setFormCategoryId('')
      setFormIsDebit(true)
    } catch (err) {
      console.error('Failed to create transaction', err)
      alert("Erreur lors de la création de la transaction.")
    } finally {
      setSaving(false)
    }
  }

  const formatMonthLabel = (ym: string) => {
    try {
      const d = parse(ym + '-01', 'yyyy-MM-dd', new Date())
      return format(d, 'MMM yyyy', { locale: fr })
    } catch {
      return ym
    }
  }

  const currentYM = format(new Date(), 'yyyy-MM')

  return (
    <div className="flex flex-col h-full gap-3 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Transactions</h2>
          <span className="text-sm text-gray-500">{filteredTxns.length} transaction{filteredTxns.length !== 1 ? 's' : ''}</span>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
        >
          + Nouvelle transaction
        </button>
      </div>

      {/* Month timeline slider */}
      {availableMonths.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2">
          <div ref={timelineRef} className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1">
            <button
              onClick={() => setSelectedMonth(null)}
              className={`flex-shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedMonth === null
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              Tout
            </button>
            {availableMonths.map((ym) => (
              <button
                key={ym}
                onClick={() => setSelectedMonth(ym === selectedMonth ? null : ym)}
                className={`flex-shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  selectedMonth === ym
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : ym === currentYM
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                    : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
                }`}
              >
                {formatMonthLabel(ym)}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <TransactionTable
            data={filteredTxns}
            categories={cats}
            accounts={accounts}
            onUpdated={loadData}
            exportUrl={exportUrl}
          />
        </div>
      )}

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Nouvelle Transaction</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date *</label>
                  <input type="date" required value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full text-sm border rounded px-3 py-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Montant *</label>
                  <div className="relative">
                    <input type="number" step="0.01" min="0" required placeholder="0.00" value={formAmount} onChange={e => setFormAmount(e.target.value)} className="w-full text-sm border rounded px-3 py-2 pr-8 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 text-right" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">€</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description *</label>
                <input type="text" required placeholder="Achat en ligne…" value={formDesc} onChange={e => setFormDesc(e.target.value)} className="w-full text-sm border rounded px-3 py-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type *</label>
                  <select value={formIsDebit ? 'debit' : 'credit'} onChange={e => setFormIsDebit(e.target.value === 'debit')} className="w-full text-sm border rounded px-3 py-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100">
                    <option value="debit">Dépense (Débit)</option>
                    <option value="credit">Revenu (Crédit)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Compte *</label>
                  <select required value={formAccountId} onChange={e => setFormAccountId(e.target.value)} className="w-full text-sm border rounded px-3 py-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100">
                    <option value="" disabled>Sélectionner…</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Catégorie</label>
                <select value={formCategoryId} onChange={e => setFormCategoryId(e.target.value)} className="w-full text-sm border rounded px-3 py-2 border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100">
                  <option value="">Non catégorisé</option>
                  {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 font-medium">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">Annuler</button>
                <button type="submit" disabled={saving} className="px-5 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50">
                  {saving ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
