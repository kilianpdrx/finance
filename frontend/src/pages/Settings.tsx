import { useEffect, useState, useMemo } from 'react'
import { categories as catApi, bankProfiles as bankProfilesApi, accounts as accApi } from '../api/client'
import { useAccountsStore } from '../store'
import type { Category, CategoryRule, BankProfile, Account, Transaction } from '../types'


type Tab = 'categories' | 'regles' | 'banques'

const TABS: { id: Tab; label: string }[] = [
  { id: 'categories', label: 'Catégories' },
  { id: 'regles', label: 'Règles' },
  { id: 'banques', label: 'Profils bancaires' },
]


export default function Settings() {
  const [tab, setTab] = useState<Tab>('categories')
  const { accounts, setAccounts } = useAccountsStore()

  useEffect(() => {
    if (!accounts.length) {
      accApi.list().then(setAccounts).catch(console.error)
    }
  }, [])

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Paramètres</h2>

      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesTab accounts={accounts} />}
      {tab === 'regles' && <ReglesTab accounts={accounts} />}
      {tab === 'banques' && <BankProfilesTab />}

    </div>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────

function CategoriesTab({ accounts }: { accounts: Account[] }) {
  const [cats, setCats] = useState<Category[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', color: '#10b981', icon: 'tag', is_income: false, expense_type: 'variable' as 'fixed' | 'variable', is_investment: false, account_id: null as number | null })
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<{ updated: number; total: number } | null>(null)
  const [editingCat, setEditingCat] = useState<{ id: number; name: string; is_income: boolean; expense_type: 'fixed' | 'variable' | null; is_investment: boolean; account_id: number | null } | null>(null)

  const load = () => catApi.list().then(setCats).catch(console.error)
  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    await catApi.create({ ...form, parent_id: null, expense_type: form.is_income ? null : form.expense_type, is_investment: form.is_income ? false : form.is_investment })
    setShowForm(false)
    setForm({ name: '', color: '#10b981', icon: 'tag', is_income: false, expense_type: 'variable', is_investment: false, account_id: null })
    load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer cette catégorie ? Les transactions associées seront déplacées vers "Divers".')) return
    await catApi.delete(id)
    load()
  }

  const handleEditSave = async () => {
    if (!editingCat || !editingCat.name.trim()) return
    await catApi.update(editingCat.id, {
      name: editingCat.name.trim(),
      is_income: editingCat.is_income,
      expense_type: editingCat.is_income ? null : editingCat.expense_type,
      is_investment: editingCat.is_income ? false : editingCat.is_investment,
      account_id: editingCat.account_id,
    })
    setEditingCat(null)
    load()
  }

  const handleRescan = async () => {
    if (!confirm('Relancer la catégorisation automatique sur toutes les transactions non révisées manuellement ?')) return
    setRescanning(true)
    setRescanResult(null)
    try {
      const result = await catApi.rescan()
      setRescanResult(result)
    } catch (e) {
      console.error(e)
    } finally {
      setRescanning(false)
    }
  }

  // Group categories by account, then by type
  const accMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a.name])), [accounts])

  const grouped = useMemo(() => {
    const groups: Record<string, Record<string, Category[]>> = {}
    const accountOrder: string[] = []

    for (const cat of cats) {
      const accountKey = cat.account_id ? (accMap[cat.account_id] ?? `Compte #${cat.account_id}`) : 'Tous les comptes'
      if (!groups[accountKey]) {
        groups[accountKey] = {}
        accountOrder.push(accountKey)
      }
      const typeKey = cat.is_income ? 'Revenus' : cat.expense_type === 'fixed' ? 'Dépenses fixes' : 'Dépenses variables'
      if (!groups[accountKey][typeKey]) groups[accountKey][typeKey] = []
      groups[accountKey][typeKey].push(cat)
    }

    // Ensure "Tous les comptes" comes first
    if (!accountOrder.includes('Tous les comptes')) accountOrder.unshift('Tous les comptes')
    else {
      const idx = accountOrder.indexOf('Tous les comptes')
      if (idx > 0) { accountOrder.splice(idx, 1); accountOrder.unshift('Tous les comptes') }
    }

    return { groups, accountOrder }
  }, [cats, accMap])

  const typeOrder = ['Revenus', 'Dépenses fixes', 'Dépenses variables']
  const typeBadge: Record<string, string> = {
    'Revenus': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    'Dépenses fixes': 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
    'Dépenses variables': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-white">Catégories ({cats.length})</h3>
        <div className="flex gap-2">
          <button
            onClick={handleRescan}
            disabled={rescanning}
            className="text-sm px-3 py-1.5 border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg disabled:opacity-50 transition-colors"
          >
            {rescanning ? (
              <span className="flex items-center gap-1.5">
                <span className="animate-spin inline-block w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full" />
                Analyse en cours…
              </span>
            ) : '⟳ Relancer catégorisation'}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-sm px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
          >
            + Ajouter
          </button>
        </div>
      </div>

      {rescanResult && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-400">
          ✓ {rescanResult.updated} transaction{rescanResult.updated !== 1 ? 's' : ''} recatégorisée{rescanResult.updated !== 1 ? 's' : ''} sur {rescanResult.total} analysées
        </div>
      )}

      {showForm && (
        <div className="flex flex-wrap gap-2 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
          <input
            placeholder="Nom"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="text-sm border border-gray-300 dark:border-slate-600 rounded px-3 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
          />
          <input
            type="color"
            value={form.color}
            onChange={(e) => setForm({ ...form, color: e.target.value })}
            className="h-9 w-12 rounded border border-gray-300 dark:border-slate-600 cursor-pointer"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={form.is_income}
              onChange={(e) => setForm({ ...form, is_income: e.target.checked, expense_type: e.target.checked ? 'variable' : form.expense_type })}
            />
            Revenu
          </label>
          {!form.is_income && (
            <select
              value={form.expense_type}
              onChange={(e) => setForm({ ...form, expense_type: e.target.value as 'fixed' | 'variable' })}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
            >
              <option value="fixed">Fixe</option>
              <option value="variable">Variable</option>
            </select>
          )}
          {!form.is_income && (
            <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={form.is_investment}
                onChange={(e) => setForm({ ...form, is_investment: e.target.checked })}
              />
              Investissement
            </label>
          )}
          <select
            value={form.account_id ?? ''}
            onChange={(e) => setForm({ ...form, account_id: e.target.value ? parseInt(e.target.value) : null })}
            className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
          >
            <option value="">Tous les comptes</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            onClick={handleCreate}
            disabled={!form.name}
            className="text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
          >
            Créer
          </button>
        </div>
      )}

      {/* Grouped categories */}
      <div className="space-y-4">
        {grouped.accountOrder.map(accountKey => {
          const typeGroups = grouped.groups[accountKey]
          if (!typeGroups) return null
          return (
            <div key={accountKey}>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                {accountKey}
              </h4>
              <div className="grid grid-cols-3 gap-3">
                {typeOrder.map(typeKey => {
                  const items = typeGroups[typeKey] ?? []
                  return (
                    <div key={typeKey}>
                      <div className="mb-1.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadge[typeKey]}`}>
                          {typeKey}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {items.map((c) => (
                          <div key={c.id}>
                            <div className="flex items-center justify-between py-1 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 group">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                                <span
                                  className="text-sm text-gray-900 dark:text-white cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 truncate"
                                  onClick={() => setEditingCat({ id: c.id, name: c.name, is_income: c.is_income, expense_type: c.expense_type, is_investment: c.is_investment ?? false, account_id: c.account_id })}
                                  title="Cliquer pour modifier"
                                >
                                  {c.name}
                                </span>
                              </div>
                              <button
                                onClick={() => handleDelete(c.id)}
                                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-1"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            {editingCat?.id === c.id && (
                              <div className="ml-4 mt-1 mb-2 p-2.5 bg-gray-50 dark:bg-slate-800 rounded-lg space-y-2 border border-gray-200 dark:border-slate-600">
                                <input
                                  autoFocus
                                  value={editingCat.name}
                                  onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(); if (e.key === 'Escape') setEditingCat(null) }}
                                  className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                                  placeholder="Nom"
                                />
                                <div className="flex gap-2 items-center flex-wrap">
                                  <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-slate-400">
                                    <input
                                      type="checkbox"
                                      checked={editingCat.is_income}
                                      onChange={(e) => setEditingCat({ ...editingCat, is_income: e.target.checked, expense_type: e.target.checked ? null : editingCat.expense_type })}
                                    />
                                    Revenu
                                  </label>
                                  {!editingCat.is_income && (
                                    <select
                                      value={editingCat.expense_type ?? 'variable'}
                                      onChange={(e) => setEditingCat({ ...editingCat, expense_type: e.target.value as 'fixed' | 'variable' })}
                                      className="text-xs border border-gray-300 dark:border-slate-600 rounded px-1.5 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                                    >
                                      <option value="fixed">Fixe</option>
                                      <option value="variable">Variable</option>
                                    </select>
                                  )}
                                  {!editingCat.is_income && (
                                    <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-slate-400">
                                      <input
                                        type="checkbox"
                                        checked={editingCat.is_investment}
                                        onChange={(e) => setEditingCat({ ...editingCat, is_investment: e.target.checked })}
                                      />
                                      Investissement
                                    </label>
                                  )}
                                  <select
                                    value={editingCat.account_id ?? ''}
                                    onChange={(e) => setEditingCat({ ...editingCat, account_id: e.target.value ? parseInt(e.target.value) : null })}
                                    className="text-xs border border-gray-300 dark:border-slate-600 rounded px-1.5 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                                  >
                                    <option value="">Tous les comptes</option>
                                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                  </select>
                                </div>
                                <div className="flex gap-1.5">
                                  <button onClick={handleEditSave} className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded">OK</button>
                                  <button onClick={() => setEditingCat(null)} className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">Annuler</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {items.length === 0 && (
                          <p className="text-xs text-gray-300 dark:text-slate-600 italic py-2 px-2">—</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Rules tab ─────────────────────────────────────────────────────────────────

const ORDER_MAP: Record<string, number> = { first: 10, standard: 100, last: 1000 }
const ORDER_LABELS: Record<string, string> = { first: 'En premier', standard: 'Standard', last: 'En dernier' }

function priorityToOrder(priority: number): string {
  if (priority <= 10) return 'first'
  if (priority <= 100) return 'standard'
  return 'last'
}

function ReglesTab({ accounts }: { accounts: Account[] }) {
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [showForm, setShowForm] = useState(false)
  const [previewTxns, setPreviewTxns] = useState<Transaction[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null)
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<number>>(new Set())
  const [merging, setMerging] = useState(false)

  const toggleRuleSelection = (id: number) => {
    setSelectedRuleIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleMergeRules = async (logicOp: 'AND' | 'OR') => {
    if (selectedRuleIds.size < 2) return
    setMerging(true)
    try {
      await catApi.mergeRules(Array.from(selectedRuleIds), logicOp)
      setSelectedRuleIds(new Set())
      load()
    } catch (e) {
      console.error('Merge failed:', e)
    } finally {
      setMerging(false)
    }
  }

  const defaultCondition = { field: 'description', operator: 'contains', value: '' }

  const [form, setForm] = useState<{
    conditions: Array<{field: string, operator: string, value: string}>,
    category_id: number,
    order: string,
    is_active: boolean,
    account_id: number | null,
    logic_operator: 'AND' | 'OR',
  }>({
    conditions: [{ ...defaultCondition }],
    category_id: 0,
    order: 'standard',
    is_active: true,
    account_id: null,
    logic_operator: 'AND',
  })

  const load = () => {
    catApi.listAllRules().then(setRules).catch(console.error)
    catApi.list().then(setCats).catch(console.error)
  }
  useEffect(() => { load() }, [])

  const catMap = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats])
  const accMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a.name])), [accounts])

  const resetForm = () => {
    setEditingRuleId(null)
    setForm({ conditions: [{ ...defaultCondition }], category_id: cats[0]?.id ?? 0, order: 'standard', is_active: true, account_id: null, logic_operator: 'AND' })
    setPreviewTxns([])
  }

  const handleCreate = async () => {
    if (!form.category_id || form.conditions.length === 0) return
    const validConditions = form.conditions.filter(c => c.value.trim() !== '')
    if (validConditions.length === 0) return

    if (editingRuleId !== null) {
      // Update existing rule
      await catApi.updateRule(editingRuleId, {
        conditions: validConditions,
        category_id: form.category_id,
        priority: ORDER_MAP[form.order] ?? 100,
        is_active: form.is_active,
        account_id: form.account_id,
        logic_operator: form.logic_operator,
      })
    } else {
      // Create new rule
      await catApi.createRule(form.category_id, {
        conditions: validConditions,
        category_id: form.category_id,
        priority: ORDER_MAP[form.order] ?? 100,
        is_active: form.is_active,
        account_id: form.account_id,
        logic_operator: form.logic_operator,
      })
    }
    setShowForm(false)
    resetForm()
    load()
    // Fire-and-forget rescan so transactions get auto-categorized
    catApi.rescan().catch(console.error)
  }

  const handleEdit = (rule: CategoryRule) => {
    setEditingRuleId(rule.id)
    setForm({
      conditions: rule.conditions && rule.conditions.length > 0
        ? rule.conditions.map(c => ({ field: c.field, operator: c.operator, value: c.value }))
        : [{ ...defaultCondition }],
      category_id: rule.category_id,
      order: priorityToOrder(rule.priority),
      is_active: rule.is_active,
      account_id: rule.account_id ?? null,
      logic_operator: rule.logic_operator ?? 'AND',
    })
    setPreviewTxns([])
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    await catApi.deleteRule(id)
    load()
  }

  const handleToggle = async (rule: CategoryRule) => {
    await catApi.updateRule(rule.id, { is_active: !rule.is_active })
    load()
  }

  const handlePreview = async () => {
    const validConditions = form.conditions.filter(c => c.value.trim() !== '')
    if (validConditions.length === 0) return
    setPreviewLoading(true)
    try {
      const txns = await catApi.previewRule(validConditions, form.account_id ?? undefined, form.logic_operator)
      setPreviewTxns(txns)
    } catch (e) {
      console.error(e)
    } finally {
      setPreviewLoading(false)
    }
  }

  // Group rules by account, then by category expense_type
  const grouped = useMemo(() => {
    const groups: Record<string, Record<string, CategoryRule[]>> = {}
    const accountOrder: string[] = []

    for (const rule of rules) {
      const accountKey = rule.account_id ? (accMap[rule.account_id] ?? `Compte #${rule.account_id}`) : 'Tous les comptes'
      if (!groups[accountKey]) {
        groups[accountKey] = {}
        accountOrder.push(accountKey)
      }
      const cat = catMap[rule.category_id]
      const typeKey = cat?.is_income ? 'Revenus' : cat?.expense_type === 'fixed' ? 'Dépenses fixes' : cat?.expense_type === 'variable' ? 'Dépenses variables' : 'Autre'
      if (!groups[accountKey][typeKey]) groups[accountKey][typeKey] = []
      groups[accountKey][typeKey].push(rule)
    }

    if (!accountOrder.includes('Tous les comptes')) accountOrder.unshift('Tous les comptes')
    else {
      const idx = accountOrder.indexOf('Tous les comptes')
      if (idx > 0) { accountOrder.splice(idx, 1); accountOrder.unshift('Tous les comptes') }
    }

    return { groups, accountOrder }
  }, [rules, catMap, accMap])

  const typeOrder = ['Revenus', 'Dépenses fixes', 'Dépenses variables']
  const typeBadge: Record<string, string> = {
    'Revenus': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    'Dépenses fixes': 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
    'Dépenses variables': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  }

  function centsToEur(cents: number): string {
    return `${(Math.abs(cents) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Règles de catégorisation ({rules.length})</h3>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm) }}
          className="text-sm px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
        >
          + Ajouter
        </button>
      </div>

      {showForm && (
        <div className="flex flex-col gap-3 p-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-600">
          {/* Row 1: Account, Priority, Category */}
          <div className="flex gap-3 items-center flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Compte:</label>
              <select
                value={form.account_id ?? ''}
                onChange={(e) => setForm({ ...form, account_id: e.target.value ? parseInt(e.target.value) : null })}
                className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              >
                <option value="">Tous</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Priorité:</label>
              <select
                value={form.order}
                onChange={(e) => setForm({ ...form, order: e.target.value })}
                className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              >
                <option value="first">En premier</option>
                <option value="standard">Standard</option>
                <option value="last">En dernier</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Catégorie:</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: parseInt(e.target.value) })}
                className="text-sm border border-gray-300 dark:border-slate-600 rounded px-3 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              >
                {(() => {
                  const filtered = cats.filter(c => c.account_id === null || c.account_id === form.account_id)
                  const revenus = filtered.filter(c => c.is_income)
                  const depFixes = filtered.filter(c => !c.is_income && c.expense_type === 'fixed')
                  const depVariables = filtered.filter(c => !c.is_income && c.expense_type === 'variable')
                  const other = filtered.filter(c => !c.is_income && c.expense_type !== 'fixed' && c.expense_type !== 'variable')
                  const groups: [string, Category[]][] = [
                    ['Revenus', revenus],
                    ['Dépenses fixes', depFixes],
                    ['Dépenses variables', depVariables],
                    ...(other.length ? [['Autres', other] as [string, Category[]]] : []),
                  ]
                  return groups.filter(([, items]) => items.length > 0).map(([label, items]) => (
                    <optgroup key={label} label={label}>
                      {items.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))
                })()}
              </select>
            </div>
          </div>

          {/* Row 2: Conditions header with logic toggle */}
          <div className="flex justify-between items-center border-t border-gray-200 dark:border-slate-600 pt-3">
            <div className="flex items-center gap-3">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {editingRuleId !== null ? 'Modifier la règle' : 'Conditions'}
              </h4>
              {form.conditions.length > 1 && (
                <div className="flex items-center bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5">
                  <button
                    onClick={() => setForm({ ...form, logic_operator: 'AND' })}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${form.logic_operator === 'AND' ? 'bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    ET (toutes)
                  </button>
                  <button
                    onClick={() => setForm({ ...form, logic_operator: 'OR' })}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${form.logic_operator === 'OR' ? 'bg-white dark:bg-slate-600 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}
                  >
                    OU (au moins une)
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setForm({ ...form, conditions: [...form.conditions, { ...defaultCondition }] })}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 flex items-center gap-1"
            >
              + Ajouter condition
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {form.conditions.map((cond, idx) => (
              <div key={idx} className="flex gap-2 items-center flex-wrap">
                <select
                  value={cond.field}
                  onChange={(e) => {
                    const newConds = [...form.conditions]
                    newConds[idx].field = e.target.value
                    setForm({ ...form, conditions: newConds })
                  }}
                  className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                >
                  <option value="description">Description</option>
                  <option value="amount">Montant (€)</option>
                  <option value="date">Date</option>
                  <option value="is_debit">Type de flux (Débit)</option>
                  <option value="currency">Devise</option>
                  <option value="account_id">Compte (ID)</option>
                </select>

                <select
                  value={cond.operator}
                  onChange={(e) => {
                    const newConds = [...form.conditions]
                    newConds[idx].operator = e.target.value
                    setForm({ ...form, conditions: newConds })
                  }}
                  className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                >
                  {['description', 'currency', 'account_id', 'date'].includes(cond.field) ? (
                    <>
                      <option value="contains">Contient</option>
                      <option value="startswith">Commence par</option>
                      <option value="equals">Est égal à</option>
                      <option value="regex">Regex</option>
                    </>
                  ) : cond.field === 'amount' ? (
                    <>
                      <option value=">">&gt;</option>
                      <option value=">=">&gt;=</option>
                      <option value="<">&lt;</option>
                      <option value="<=">&lt;=</option>
                      <option value="equals">=</option>
                    </>
                  ) : (
                    <option value="equals">Est (true/false)</option>
                  )}
                </select>

                <input
                  placeholder="Valeur"
                  value={cond.value}
                  onChange={(e) => {
                    const newConds = [...form.conditions]
                    newConds[idx].value = e.target.value
                    setForm({ ...form, conditions: newConds })
                  }}
                  className="flex-1 min-w-[150px] text-sm border border-gray-300 dark:border-slate-600 rounded px-3 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                />

                {form.conditions.length > 1 && (
                  <button
                    onClick={() => {
                      const newConds = [...form.conditions]
                      newConds.splice(idx, 1)
                      setForm({ ...form, conditions: newConds })
                    }}
                    className="text-gray-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 items-center mt-2 border-t border-gray-200 dark:border-slate-600 pt-3 justify-end">
              <button
                onClick={handlePreview}
                disabled={previewLoading || form.conditions.every(c => !c.value.trim())}
                className="text-sm px-3 py-1.5 border border-emerald-400 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded disabled:opacity-50"
              >
                {previewLoading ? 'Chargement…' : 'Aperçu'}
              </button>
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                className="text-sm px-3 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded"
              >
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={form.conditions.every(c => !c.value.trim()) || !form.category_id}
                className="text-sm px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
              >
                {editingRuleId !== null ? 'Mettre à jour' : 'Enregistrer'}
              </button>
          </div>

          {/* Preview results */}
          {previewTxns.length > 0 && (
            <div className="border-t border-gray-200 dark:border-slate-600 pt-3 mt-1">
              <h5 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                Transactions correspondantes ({previewTxns.length})
              </h5>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {previewTxns.map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-white dark:bg-slate-900">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-gray-400 w-20 flex-shrink-0">{txn.date}</span>
                      <span className="text-gray-700 dark:text-gray-300 truncate">{txn.description}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-gray-400">{txn.account_name}</span>
                      <span className={txn.is_debit ? 'text-red-500' : 'text-green-500'}>
                        {txn.is_debit ? '-' : '+'}{centsToEur(txn.amount_cents)}
                      </span>
                      <span className="text-gray-400 w-24 text-right truncate">
                        {txn.category_id ? (catMap[txn.category_id]?.name ?? '—') : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Merge bar */}
      {selectedRuleIds.size >= 2 && (
        <div className="flex items-center gap-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3">
          <span className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
            {selectedRuleIds.size} règles sélectionnées
          </span>
          <button
            onClick={() => handleMergeRules('OR')}
            disabled={merging}
            className="text-sm px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Fusionner (OU)
          </button>
          <button
            onClick={() => handleMergeRules('AND')}
            disabled={merging}
            className="text-sm px-3 py-1.5 border border-indigo-400 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Fusionner (ET)
          </button>
          <button
            onClick={() => setSelectedRuleIds(new Set())}
            className="text-sm px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Grouped rules */}
      <div className="space-y-4">
        {grouped.accountOrder.map(accountKey => {
          const typeGroups = grouped.groups[accountKey]
          if (!typeGroups) return null
          return (
            <div key={accountKey}>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                {accountKey}
              </h4>
              {typeOrder.map(typeKey => {
                const items = typeGroups[typeKey]
                if (!items?.length) return null
                return (
                  <div key={typeKey} className="mb-3">
                    <div className="flex items-center gap-2 mb-1 ml-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadge[typeKey]}`}>
                        {typeKey}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {items.map((r) => (
                        <div key={r.id} className={`flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 group ${selectedRuleIds.has(r.id) ? 'bg-indigo-50 dark:bg-indigo-900/10 ring-1 ring-indigo-200 dark:ring-indigo-800' : ''}`}>
                          <div className="flex items-start gap-2 flex-1">
                            <input
                              type="checkbox"
                              checked={selectedRuleIds.has(r.id)}
                              onChange={() => toggleRuleSelection(r.id)}
                              className="mt-1.5 w-4 h-4 accent-indigo-600 cursor-pointer flex-shrink-0"
                            />
                          <div className="flex flex-col gap-1 items-start flex-wrap flex-1">
                            <div className="flex flex-wrap gap-2 items-center">
                              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded">
                                {catMap[r.category_id]?.name ?? `#${r.category_id}`}
                              </span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                priorityToOrder(r.priority) === 'first'
                                  ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                  : priorityToOrder(r.priority) === 'last'
                                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                  : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                              }`}>
                                {ORDER_LABELS[priorityToOrder(r.priority)]}
                              </span>
                              {!r.is_active && <span className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 rounded">Désactivée</span>}
                            </div>
                            <div className="flex flex-col gap-1 w-full pl-2 border-l-2 border-gray-200 dark:border-slate-600 mt-1">
                              {r.conditions && r.conditions.map((cond, i) => (
                                <span key={i} className={`text-xs font-mono bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded w-fit ${r.is_active ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 line-through'}`}>
                                  <span className="text-emerald-500 dark:text-emerald-400">{cond.field}</span> {cond.operator} "{cond.value}"
                                  {i < r.conditions.length - 1 && <span className="ml-2 text-gray-400 font-sans italic">{r.logic_operator === 'OR' ? 'OU' : 'ET'}</span>}
                                </span>
                              ))}
                            </div>
                          </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleEdit(r)}
                              className="text-xs px-2 py-0.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                              title="Modifier cette règle"
                            >
                              Modifier
                            </button>
                            <button
                              onClick={() => handleToggle(r)}
                              className={`text-xs px-2 py-0.5 rounded ${r.is_active ? 'text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20' : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'}`}
                            >
                              {r.is_active ? 'Désact.' : 'Activer'}
                            </button>
                            <button
                              onClick={() => handleDelete(r.id)}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Bank profiles tab ─────────────────────────────────────────────────────────

const COLUMN_FIELD_OPTIONS = ['date', 'description', 'amount', 'debit', 'credit', 'balance']

const DEFAULT_BANK_FORM = {
  name: '',
  column_mapping: {} as Record<string, string>,
  date_format: '%d/%m/%Y',
  encoding: 'utf-8',
  delimiter: ';',
  detection_fingerprint: null as null | Record<string, unknown>,
}

function BankProfilesTab() {
  const [profiles, setProfiles] = useState<BankProfile[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<BankProfile | null>(null)
  const [form, setForm] = useState(DEFAULT_BANK_FORM)
  const [rawMapping, setRawMapping] = useState('')
  const [loading, setLoading] = useState(false)

  const load = () => bankProfilesApi.list().then(setProfiles).catch(console.error)
  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(DEFAULT_BANK_FORM)
    setRawMapping('{\n  "date": "Date",\n  "description": "Libellé",\n  "amount": "Montant"\n}')
    setShowForm(true)
  }

  const openEdit = (p: BankProfile) => {
    setEditing(p)
    setForm({
      name: p.name,
      column_mapping: p.column_mapping,
      date_format: p.date_format,
      encoding: p.encoding,
      delimiter: p.delimiter,
      detection_fingerprint: p.detection_fingerprint,
    })
    setRawMapping(JSON.stringify(p.column_mapping, null, 2))
    setShowForm(true)
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      let mapping: Record<string, string> = {}
      try { mapping = JSON.parse(rawMapping) } catch { mapping = form.column_mapping }
      const payload = { ...form, column_mapping: mapping }
      if (editing) {
        await bankProfilesApi.update(editing.id, payload)
      } else {
        await bankProfilesApi.create(payload)
      }
      setShowForm(false)
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce profil bancaire ?')) return
    await bankProfilesApi.delete(id)
    load()
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Profils bancaires ({profiles.length})</h3>
        <button onClick={openCreate} className="text-sm px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
          + Nouveau profil
        </button>
      </div>

      {showForm && (
        <div className="border border-gray-200 dark:border-slate-600 rounded-xl p-4 space-y-3 bg-gray-50 dark:bg-slate-800">
          <h4 className="font-medium text-gray-900 dark:text-white text-sm">
            {editing ? `Modifier : ${editing.name}` : 'Nouveau profil bancaire'}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Nom de la banque</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Format de date</label>
              <input
                value={form.date_format}
                onChange={(e) => setForm({ ...form, date_format: e.target.value })}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Encodage</label>
              <select
                value={form.encoding}
                onChange={(e) => setForm({ ...form, encoding: e.target.value })}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              >
                <option value="utf-8">UTF-8</option>
                <option value="latin-1">Latin-1 (ISO-8859-1)</option>
                <option value="cp1252">Windows-1252</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Séparateur</label>
              <select
                value={form.delimiter}
                onChange={(e) => setForm({ ...form, delimiter: e.target.value })}
                className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              >
                <option value=";">Point-virgule (;)</option>
                <option value=",">Virgule (,)</option>
                <option value="\t">Tabulation</option>
                <option value="|">Pipe (|)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">
              Correspondance colonnes (JSON) — Clés : {COLUMN_FIELD_OPTIONS.join(', ')}
            </label>
            <textarea
              value={rawMapping}
              onChange={(e) => setRawMapping(e.target.value)}
              rows={6}
              className="w-full text-sm font-mono border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="text-sm px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700">
              Annuler
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !form.name}
              className="text-sm px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
            >
              {loading ? '…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-gray-50 dark:bg-slate-800 group">
            <div>
              <p className="font-medium text-sm text-gray-900 dark:text-white">{p.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {p.encoding} · {p.delimiter === ';' ? 'point-virgule' : p.delimiter === ',' ? 'virgule' : p.delimiter} · {p.date_format}
              </p>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => openEdit(p)}
                className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <p className="text-center text-gray-400 py-6 text-sm">Aucun profil bancaire.</p>
        )}
      </div>
    </div>
  )
}



