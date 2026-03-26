import { useEffect, useState } from 'react'
import { accounts as accApi, analytics, bankProfiles as bankProfilesApi, snapshots as snapApi } from '../api/client'
import type { Account, BankProfile, AccountBalanceSnapshot } from '../types'
import NetWorthEvolution from '../components/charts/NetWorthEvolution'
import { format } from 'date-fns'

type AccountForm = {
  name: string
  bank_name: string
  account_type: 'courant' | 'épargne' | 'investissement' | 'crédit'
  currency: string
  color: string
}

type SnapshotForm = {
  date: string
  amount: string
  currency: string
  notes: string
}

const DEFAULT_FORM: AccountForm = {
  name: '',
  bank_name: '',
  account_type: 'courant',
  currency: 'EUR',
  color: '#6366f1',
}

const TYPE_LABELS: Record<string, string> = {
  courant: 'Compte courant',
  épargne: 'Épargne',
  investissement: 'Investissement',
  crédit: 'Crédit',
}

const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP', 'JPY', 'CAD']

function centsToDisplay(cents: number, currency = 'EUR'): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const formatted = (abs / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return `${sign}${formatted} ${currency}`
}

function parseAmountInput(s: string): number {
  const cleaned = s.replace(',', '.').replace(/\s/g, '').replace(/[^\d.-]/g, '')
  return Math.round(parseFloat(cleaned || '0') * 100)
}

// ── Snapshot Modal ────────────────────────────────────────────────────────────

interface SnapshotModalProps {
  account: Account
  snapshots: AccountBalanceSnapshot[]
  onClose: () => void
  onSaved: () => void
}

function SnapshotModal({ account, snapshots, onClose, onSaved }: SnapshotModalProps) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [form, setForm] = useState<SnapshotForm>({
    date: today,
    amount: '',
    currency: account.currency || 'EUR',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    const amount_cents = parseAmountInput(form.amount)
    if (isNaN(amount_cents)) {
      setError('Montant invalide')
      return
    }
    setSaving(true)
    setError('')
    try {
      await snapApi.create(account.id, {
        date: form.date,
        amount_cents,
        currency: form.currency,
        notes: form.notes || undefined,
      })
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (snapId: number) => {
    if (!confirm('Supprimer ce solde ?')) return
    await snapApi.delete(account.id, snapId)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-lg border border-gray-200 dark:border-slate-600 shadow-xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          Soldes manuels — {account.name}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Saisissez le solde réel du compte à une date donnée. Le patrimoine sera recalculé en conséquence.
        </p>

        {/* New snapshot form */}
        <div className="space-y-3 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Devise</label>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
              >
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Montant (solde total du compte)</label>
            <input
              type="text"
              placeholder="Ex: 12345.67"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Notes (optionnel)</label>
            <input
              type="text"
              placeholder="Ex: Solde au relevé de décembre"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving || !form.amount || !form.date}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? '…' : 'Enregistrer ce solde'}
          </button>
        </div>

        {/* Existing snapshots */}
        {snapshots.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Historique des soldes</p>
            <div className="space-y-2">
              {snapshots.map(snap => (
                <div key={snap.id} className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-slate-800 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {centsToDisplay(snap.amount_cents, snap.currency)}
                    </p>
                    <p className="text-xs text-gray-500">{snap.date}{snap.notes ? ` · ${snap.notes}` : ''}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(snap.id)}
                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Accounts page ────────────────────────────────────────────────────────

export default function Accounts() {
  const [accs, setAccs] = useState<Account[]>([])
  const [bankProfileList, setBankProfileList] = useState<BankProfile[]>([])
  const [netWorth, setNetWorth] = useState<Record<string, unknown>[]>([])
  const [balances, setBalances] = useState<Record<number, number>>({})
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<AccountForm>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [bankInputMode, setBankInputMode] = useState<'select' | 'custom'>('select')

  // Snapshot modal state
  const [snapshotAccount, setSnapshotAccount] = useState<Account | null>(null)
  const [snapshotList, setSnapshotList] = useState<AccountBalanceSnapshot[]>([])

  const load = async () => {
    const [accsData, nw, profiles] = await Promise.all([
      accApi.list(),
      analytics.netWorth(),
      bankProfilesApi.list(),
    ])
    setAccs(accsData)
    setNetWorth(nw)
    setBankProfileList(profiles)

    // Compute balances from netWorth data (last entry per account)
    if (nw.length > 0) {
      const last = nw[nw.length - 1]
      const balanceMap: Record<number, number> = {}
      accsData.forEach((acc) => {
        const val = last[acc.name + '_native'] ?? last[acc.name]
        if (typeof val === 'number') {
          balanceMap[acc.id] = val
        }
      })
      setBalances(balanceMap)
    }
  }

  useEffect(() => { load() }, [])

  const openSnapshotModal = async (acc: Account) => {
    setSnapshotAccount(acc)
    try {
      const snaps = await snapApi.list(acc.id)
      setSnapshotList(snaps)
    } catch {
      setSnapshotList([])
    }
  }

  const closeSnapshotModal = () => {
    setSnapshotAccount(null)
    setSnapshotList([])
  }

  const handleSnapshotSaved = async () => {
    if (snapshotAccount) {
      const snaps = await snapApi.list(snapshotAccount.id)
      setSnapshotList(snaps)
    }
    await load()  // Refresh balances
  }

  const openCreate = () => {
    setEditing(null)
    setForm(DEFAULT_FORM)
    setBankInputMode(bankProfileList.length > 0 ? 'select' : 'custom')
    setShowModal(true)
  }

  const openEdit = (acc: Account) => {
    setEditing(acc)
    setForm({ name: acc.name, bank_name: acc.bank_name, account_type: acc.account_type as AccountForm['account_type'], currency: acc.currency, color: acc.color })
    const matchesProfile = bankProfileList.some(p => p.name === acc.bank_name)
    setBankInputMode(matchesProfile ? 'select' : 'custom')
    setShowModal(true)
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      if (editing) {
        await accApi.update(editing.id, form)
      } else {
        await accApi.create(form as Parameters<typeof accApi.create>[0])
      }
      setShowModal(false)
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Désactiver ce compte ?')) return
    await accApi.delete(id)
    load()
  }

  const totalByType = accs.reduce((acc, a) => {
    const balance = balances[a.id] ?? 0
    if (!acc[a.account_type]) acc[a.account_type] = 0
    acc[a.account_type] += balance
    return acc
  }, {} as Record<string, number>)

  const netWorthTotal = Object.values(balances).reduce((s, v) => s + v, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Comptes</h2>
          {Object.keys(balances).length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              Patrimoine total : <span className="font-semibold text-emerald-600 dark:text-emerald-400">{centsToDisplay(netWorthTotal)}</span>
            </p>
          )}
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + Nouveau compte
        </button>
      </div>

      {/* Type summary */}
      {Object.keys(totalByType).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(totalByType).map(([type, total]) => (
            <div key={type} className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{TYPE_LABELS[type] ?? type}</p>
              <p className={`text-base font-bold mt-0.5 ${total >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-500'}`}>
                {centsToDisplay(total)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Account cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accs.map((acc) => (
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
              <div className="flex gap-1">
                <button
                  onClick={() => openSnapshotModal(acc)}
                  title="Ajouter un solde manuel"
                  className="p-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded text-gray-400 hover:text-emerald-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  onClick={() => openEdit(acc)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(acc.id)}
                  className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-gray-400 hover:text-red-500"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">
                {TYPE_LABELS[acc.account_type] ?? acc.account_type}
              </span>
              {balances[acc.id] !== undefined ? (
                <span className={`text-sm font-bold ${balances[acc.id] >= 0 ? 'text-gray-900 dark:text-white' : 'text-red-500'}`}>
                  {centsToDisplay(balances[acc.id], acc.currency)}
                </span>
              ) : (
                <button
                  onClick={() => openSnapshotModal(acc)}
                  className="text-xs text-emerald-500 hover:text-emerald-700"
                >
                  + Ajouter un solde
                </button>
              )}
            </div>
          </div>
        ))}
        {accs.length === 0 && (
          <p className="col-span-3 text-center text-gray-400 py-12">
            Aucun compte. Créez-en un pour commencer.
          </p>
        )}
      </div>

      {/* Net worth chart */}
      {netWorth.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Évolution du patrimoine</h3>
          <NetWorthEvolution data={netWorth} />
        </div>
      )}

      {/* Account modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md border border-gray-200 dark:border-slate-600 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editing ? 'Modifier le compte' : 'Nouveau compte'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">Nom du compte</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm text-gray-600 dark:text-gray-400">Banque</label>
                  {bankProfileList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBankInputMode(bankInputMode === 'select' ? 'custom' : 'select')}
                      className="text-xs text-emerald-500 hover:text-emerald-700"
                    >
                      {bankInputMode === 'select' ? '+ Autre banque' : '← Choisir dans la liste'}
                    </button>
                  )}
                </div>
                {bankInputMode === 'select' && bankProfileList.length > 0 ? (
                  <select
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                    className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  >
                    <option value="">-- Sélectionner une banque --</option>
                    {bankProfileList.map((p) => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Nom de la banque"
                    value={form.bank_name}
                    onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                    className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">Type de compte</label>
                <select
                  value={form.account_type}
                  onChange={(e) => setForm({ ...form, account_type: e.target.value as AccountForm['account_type'] })}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">Devise</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400 block mb-1">Couleur</label>
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="h-9 w-16 rounded border border-gray-300 dark:border-slate-600 cursor-pointer"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
              >
                Annuler
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !form.name || !form.bank_name}
                className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
              >
                {loading ? '…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot modal */}
      {snapshotAccount && (
        <SnapshotModal
          account={snapshotAccount}
          snapshots={snapshotList}
          onClose={closeSnapshotModal}
          onSaved={handleSnapshotSaved}
        />
      )}
    </div>
  )
}
