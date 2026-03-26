import { useEffect, useState, useMemo } from 'react'
import { categories as catApi, ml, bankProfiles as bankProfilesApi, settingsApi, accounts as accApi } from '../api/client'
import { useAccountsStore } from '../store'
import type { Category, CategoryRule, MLStatus, BankProfile, ExchangeRate, Account, Transaction } from '../types'

type Tab = 'categories' | 'regles' | 'banques' | 'devises' | 'modele'

const TABS: { id: Tab; label: string }[] = [
  { id: 'categories', label: 'Catégories' },
  { id: 'regles', label: 'Règles' },
  { id: 'banques', label: 'Profils bancaires' },
  { id: 'devises', label: 'Devises' },
  { id: 'modele', label: 'Modèle ML' },
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
      {tab === 'devises' && <DevisesTab />}
      {tab === 'modele' && <ModeleTab />}
    </div>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────

function CategoriesTab({ accounts }: { accounts: Account[] }) {
  const [cats, setCats] = useState<Category[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', color: '#10b981', icon: 'tag', is_income: false, expense_type: null as 'fixed' | 'variable' | null, account_id: null as number | null })
  const [rescanning, setRescanning] = useState(false)
  const [rescanResult, setRescanResult] = useState<{ updated: number; total: number } | null>(null)
  const [editingCatId, setEditingCatId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingAccountCatId, setEditingAccountCatId] = useState<number | null>(null)

  const load = () => catApi.list().then(setCats).catch(console.error)
  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    await catApi.create({ ...form, parent_id: null, expense_type: form.is_income ? null : form.expense_type })
    setShowForm(false)
    setForm({ name: '', color: '#10b981', icon: 'tag', is_income: false, expense_type: null, account_id: null })
    load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer cette catégorie ? Les transactions associées seront déplacées vers "Divers".')) return
    await catApi.delete(id)
    load()
  }

  const handleRename = async (id: number) => {
    if (!editingName.trim()) return
    await catApi.update(id, { name: editingName.trim() })
    setEditingCatId(null)
    load()
  }

  const handleChangeAccount = async (catId: number, newAccountId: number | null) => {
    await catApi.update(catId, { account_id: newAccountId })
    setEditingAccountCatId(null)
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
      const typeKey = cat.is_income ? 'Revenus' : cat.expense_type === 'fixed' ? 'Dépenses fixes' : cat.expense_type === 'variable' ? 'Dépenses variables' : 'Autre'
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

  const typeOrder = ['Revenus', 'Dépenses fixes', 'Dépenses variables', 'Autre']
  const typeBadge: Record<string, string> = {
    'Revenus': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    'Dépenses fixes': 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
    'Dépenses variables': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    'Autre': 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
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
              onChange={(e) => setForm({ ...form, is_income: e.target.checked, expense_type: e.target.checked ? null : form.expense_type })}
            />
            Revenu
          </label>
          {!form.is_income && (
            <select
              value={form.expense_type ?? ''}
              onChange={(e) => setForm({ ...form, expense_type: (e.target.value || null) as 'fixed' | 'variable' | null })}
              className="text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
            >
              <option value="">Type...</option>
              <option value="fixed">Fixe</option>
              <option value="variable">Variable</option>
            </select>
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
              {typeOrder.map(typeKey => {
                const items = typeGroups[typeKey]
                if (!items?.length) return null
                return (
                  <div key={typeKey} className="mb-2">
                    <div className="flex items-center gap-2 mb-1 ml-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadge[typeKey]}`}>
                        {typeKey}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {items.map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 group">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                            {editingCatId === c.id ? (
                              <input
                                autoFocus
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRename(c.id)
                                  if (e.key === 'Escape') setEditingCatId(null)
                                }}
                                onBlur={() => handleRename(c.id)}
                                className="text-sm border border-emerald-400 rounded px-2 py-0.5 bg-white dark:bg-slate-900 text-gray-900 dark:text-white w-48"
                              />
                            ) : (
                              <span
                                className="text-sm text-gray-900 dark:text-white cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 truncate"
                                onClick={() => { setEditingCatId(c.id); setEditingName(c.name) }}
                                title="Cliquer pour renommer"
                              >
                                {c.name}
                              </span>
                            )}
                            {/* Account assignment badge / selector */}
                            {editingAccountCatId === c.id ? (
                              <select
                                autoFocus
                                value={c.account_id ?? ''}
                                onChange={(e) => handleChangeAccount(c.id, e.target.value ? parseInt(e.target.value) : null)}
                                onBlur={() => setEditingAccountCatId(null)}
                                className="text-xs border border-emerald-400 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-gray-700 dark:text-gray-300 flex-shrink-0"
                              >
                                <option value="">Tous les comptes</option>
                                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            ) : (
                              <span
                                onClick={() => setEditingAccountCatId(c.id)}
                                className="text-xs px-1.5 py-0.5 rounded cursor-pointer flex-shrink-0 bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                                title="Cliquer pour changer le compte"
                              >
                                {c.account_id ? (accMap[c.account_id] ?? `#${c.account_id}`) : 'Tous'}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
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

  const defaultCondition = { field: 'description', operator: 'contains', value: '' }

  const [form, setForm] = useState<{
    conditions: Array<{field: string, operator: string, value: string}>,
    category_id: number,
    order: string,
    is_active: boolean,
    account_id: number | null,
  }>({
    conditions: [{ ...defaultCondition }],
    category_id: 0,
    order: 'standard',
    is_active: true,
    account_id: null,
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
    setForm({ conditions: [{ ...defaultCondition }], category_id: cats[0]?.id ?? 0, order: 'standard', is_active: true, account_id: null })
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
      })
    } else {
      // Create new rule
      await catApi.createRule(form.category_id, {
        conditions: validConditions,
        category_id: form.category_id,
        priority: ORDER_MAP[form.order] ?? 100,
        is_active: form.is_active,
        account_id: form.account_id,
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
      const txns = await catApi.previewRule(validConditions, form.account_id ?? undefined)
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

  const typeOrder = ['Revenus', 'Dépenses fixes', 'Dépenses variables', 'Autre']
  const typeBadge: Record<string, string> = {
    'Revenus': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    'Dépenses fixes': 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
    'Dépenses variables': 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    'Autre': 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
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
          <div className="flex justify-between items-center mb-1">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {editingRuleId !== null ? 'Modifier la règle' : 'Conditions'} (Toutes doivent être vraies)
            </h4>
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

          <div className="flex gap-3 items-center mt-2 border-t border-gray-200 dark:border-slate-600 pt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Catégorie:</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: parseInt(e.target.value) })}
                className="text-sm border border-gray-300 dark:border-slate-600 rounded px-3 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
              >
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Ordre:</label>
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

            <div className="flex-1 flex justify-end gap-2">
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
                        <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 group">
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
                                  {i < r.conditions.length - 1 && <span className="ml-2 text-gray-400 font-sans italic">ET</span>}
                                </span>
                              ))}
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

// ── Devises tab ───────────────────────────────────────────────────────────────

const COMMON_CURRENCIES = [
  { code: 'CHF', label: 'Franc suisse', symbol: 'Fr.' },
  { code: 'USD', label: 'Dollar américain', symbol: '$' },
  { code: 'GBP', label: 'Livre sterling', symbol: '£' },
  { code: 'JPY', label: 'Yen japonais', symbol: '¥' },
  { code: 'CAD', label: 'Dollar canadien', symbol: 'CA$' },
]

function DevisesTab() {
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [form, setForm] = useState({ currency_code: '', rate: '' })
  const [editing, setEditing] = useState<ExchangeRate | null>(null)
  const [editRate, setEditRate] = useState('')
  const [loading, setLoading] = useState(false)

  const load = () => settingsApi.listExchangeRates().then(setRates).catch(console.error)
  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!form.currency_code || !form.rate) return
    setLoading(true)
    try {
      const rateTenThousandths = Math.round(parseFloat(form.rate.replace(',', '.')) * 10000)
      await settingsApi.createExchangeRate({ currency_code: form.currency_code, rate_ten_thousandths: rateTenThousandths })
      setForm({ currency_code: '', rate: '' })
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (rate: ExchangeRate) => {
    setLoading(true)
    try {
      const rateTenThousandths = Math.round(parseFloat(editRate.replace(',', '.')) * 10000)
      await settingsApi.updateExchangeRate(rate.currency_code, rateTenThousandths)
      setEditing(null)
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (code: string) => {
    if (!confirm(`Supprimer le taux de change pour ${code} ?`)) return
    await settingsApi.deleteExchangeRate(code)
    load()
  }

  const formatRate = (tenThousandths: number) => (tenThousandths / 10000).toFixed(4)

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 space-y-5 max-w-lg">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Taux de change</h3>
        <p className="text-sm text-gray-500">
          Définissez le taux de conversion vers l'euro (1 unité de devise = X EUR).
          Ces taux sont utilisés pour les conversions dans les analyses.
        </p>
      </div>

      <div className="space-y-2">
        {rates.map((r) => (
          <div key={r.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-slate-800">
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold text-sm text-gray-900 dark:text-white w-10">{r.currency_code}</span>
              {editing?.id === r.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editRate}
                    onChange={(e) => setEditRate(e.target.value)}
                    className="w-24 text-sm border border-emerald-400 rounded px-2 py-1 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                    autoFocus
                  />
                  <span className="text-xs text-gray-400">EUR</span>
                </div>
              ) : (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  1 {r.currency_code} = <strong>{formatRate(r.rate_ten_thousandths)}</strong> EUR
                </span>
              )}
            </div>
            <div className="flex gap-1">
              {editing?.id === r.id ? (
                <>
                  <button onClick={() => handleUpdate(r)} disabled={loading} className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">✓</button>
                  <button onClick={() => setEditing(null)} className="text-xs px-2 py-1 border border-gray-300 dark:border-slate-600 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700">✕</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setEditing(r); setEditRate(formatRate(r.rate_ten_thousandths)) }} className="text-xs text-gray-400 hover:text-emerald-500 px-1">Modifier</button>
                  <button onClick={() => handleDelete(r.currency_code)} className="text-xs text-gray-400 hover:text-red-500 px-1">✕</button>
                </>
              )}
            </div>
          </div>
        ))}
        {rates.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-4">
            Aucun taux de change configuré. L'euro (EUR) est la devise de référence.
          </p>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-slate-600 pt-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ajouter un taux</p>
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-32">
            <select
              value={form.currency_code}
              onChange={(e) => setForm({ ...form, currency_code: e.target.value })}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            >
              <option value="">Devise…</option>
              {COMMON_CURRENCIES.filter(c => !rates.some(r => r.currency_code === c.code)).map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.label}</option>
              ))}
              <option value="_custom">Autre…</option>
            </select>
          </div>
          {form.currency_code === '_custom' && (
            <input
              placeholder="Code (ex: NOK)"
              onChange={(e) => setForm({ ...form, currency_code: e.target.value.toUpperCase() })}
              className="w-20 text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            />
          )}
          <input
            type="text"
            placeholder="Taux (ex: 0.97)"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
            className="w-36 text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
          />
          <button
            onClick={handleCreate}
            disabled={loading || !form.currency_code || !form.rate}
            className="text-sm px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ML tab ────────────────────────────────────────────────────────────────────

function ModeleTab() {
  const [status, setStatus] = useState<MLStatus | null>(null)
  const [training, setTraining] = useState(false)
  const [result, setResult] = useState<{ accuracy: number; sample_count: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ml.status().then(setStatus).catch(console.error)
  }, [])

  const handleTrain = async () => {
    setTraining(true)
    setError('')
    setResult(null)
    try {
      const res = await ml.train()
      setResult(res)
      setStatus(await ml.status())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur d\'entraînement')
    } finally {
      setTraining(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6 space-y-5 max-w-lg">
      <h3 className="font-semibold text-gray-900 dark:text-white">Modèle de catégorisation automatique</h3>

      {status && (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Statut</span>
            <span className={status.trained ? 'text-green-500 font-medium' : 'text-gray-400'}>
              {status.trained ? 'Entraîné' : 'Non entraîné'}
            </span>
          </div>
          {status.last_trained && (
            <div className="flex justify-between">
              <span className="text-gray-500">Dernière mise à jour</span>
              <span className="text-gray-700 dark:text-gray-300">
                {new Date(status.last_trained).toLocaleString('fr-FR')}
              </span>
            </div>
          )}
          {status.sample_count !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Échantillons</span>
              <span className="text-gray-700 dark:text-gray-300">{status.sample_count}</span>
            </div>
          )}
          {status.accuracy !== null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Précision</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {(status.accuracy * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-400">
          ✓ Modèle entraîné avec succès — précision: {(result.accuracy * 100).toFixed(1)}% sur {result.sample_count} échantillons
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <p className="text-sm text-gray-500">
        Le modèle apprend à partir de vos transactions catégorisées pour suggérer automatiquement des catégories lors de futurs imports. Il nécessite au minimum 10 transactions catégorisées.
      </p>

      <button
        onClick={handleTrain}
        disabled={training}
        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
      >
        {training ? 'Entraînement en cours…' : 'Réentraîner le modèle'}
      </button>
    </div>
  )
}
