import { useState, useCallback, useEffect } from 'react'
import { upload as uploadApi, accounts as accApi, categories as catApi } from '../api/client'
import type { DetectResponse, Account, ParsePreviewTransaction, Category } from '../types'

function centsToEur(cents: number, isDebit: boolean): string {
  const sign = isDebit ? '-' : '+'
  return `${sign}${(Math.abs(cents) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`
}

const COLUMN_FIELD_OPTIONS = [
  { value: 'date', label: 'Date' },
  { value: 'description', label: 'Libellé' },
  { value: 'amount', label: 'Montant (signé)' },
  { value: 'debit', label: 'Débit' },
  { value: 'credit', label: 'Crédit' },
  { value: 'balance', label: 'Solde' },
  { value: '_ignore', label: 'Ignorer' },
]

// ── Local live preview (no API call) ─────────────────────────────────────────

function buildLocalPreview(
  rawHeaders: string[],
  rawPreview: string[][],
  mapping: Record<number, string>,
  delimiter: string,
): Array<{ date: string; description: string; amount: string }> {
  const headerToIdx: Record<string, number> = {}
  rawHeaders.forEach((h, i) => { headerToIdx[i] = i })

  const fieldToColIdx: Record<string, number> = {}
  for (const [idxStr, field] of Object.entries(mapping)) {
    if (field && field !== '_ignore') {
      fieldToColIdx[field] = parseInt(idxStr)
    }
  }

  return rawPreview.slice(0, 5).map(row => {
    const dateIdx = fieldToColIdx['date']
    const descIdx = fieldToColIdx['description']
    const amtIdx = fieldToColIdx['amount']
    const debitIdx = fieldToColIdx['debit']
    const creditIdx = fieldToColIdx['credit']

    const dateVal = dateIdx !== undefined ? (row[dateIdx] ?? '') : ''
    const descVal = descIdx !== undefined ? (row[descIdx] ?? '') : ''

    let amtVal = ''
    if (amtIdx !== undefined && row[amtIdx]) {
      amtVal = row[amtIdx]
    } else if (debitIdx !== undefined && row[debitIdx] && row[debitIdx].replace(/[^0-9.,]/g, '') !== '') {
      amtVal = `−${row[debitIdx]}`
    } else if (creditIdx !== undefined && row[creditIdx] && row[creditIdx].replace(/[^0-9.,]/g, '') !== '') {
      amtVal = `+${row[creditIdx]}`
    }

    return { date: dateVal, description: descVal, amount: amtVal }
  }).filter(r => r.date || r.description)
}

// ── Column Mapping Step ───────────────────────────────────────────────────────

interface ColumnMappingStepProps {
  rawHeaders: string[]
  rawPreview: string[][]
  file: File
  accounts: Account[]
  selectedAccount: string
  onSelectAccount: (v: string) => void
  onConfirm: (
    mapping: Record<string, string>,
    dateFormat: string,
    encoding: string,
    delimiter: string,
    profileName: string,
    saveProfile: boolean,
  ) => void
  onBack: () => void
  loading: boolean
  error: string
}

function ColumnMappingStep({
  rawHeaders, rawPreview, file, accounts, selectedAccount, onSelectAccount,
  onConfirm, onBack, loading, error,
}: ColumnMappingStepProps) {
  const [mapping, setMapping] = useState<Record<number, string>>({})
  const [dateFormat, setDateFormat] = useState('%d/%m/%Y')
  const [encoding, setEncoding] = useState('utf-8')
  const [delimiter, setDelimiter] = useState(';')
  const [saveProfile, setSaveProfile] = useState(false)

  const handleMapping = (colIdx: number, fieldKey: string) => {
    setMapping(prev => ({ ...prev, [colIdx]: fieldKey }))
  }

  const buildColumnMapping = (): Record<string, string> => {
    const result: Record<string, string> = {}
    for (const [idxStr, fieldKey] of Object.entries(mapping)) {
      if (fieldKey && fieldKey !== '_ignore') {
        result[fieldKey] = rawHeaders[parseInt(idxStr)]
      }
    }
    return result
  }

  const isValid = () => {
    const mapped = Object.values(mapping).filter(v => v && v !== '_ignore')
    const hasDate = mapped.includes('date')
    const hasDesc = mapped.includes('description')
    const hasAmount = mapped.includes('amount') || (mapped.includes('debit') && mapped.includes('credit'))
    const hasAccount = !!selectedAccount
    return hasDate && hasDesc && hasAmount && hasAccount
  }

  const localPreview = buildLocalPreview(rawHeaders, rawPreview, mapping, delimiter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Format inconnu — Configurer la correspondance</h2>
          <p className="text-sm text-gray-500 mt-1">
            Fichier : <span className="font-mono text-emerald-600 dark:text-emerald-400">{file.name}</span>
            {' · '}Associez chaque colonne CSV au champ correspondant.
          </p>
        </div>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          ← Recommencer
        </button>
      </div>

      {/* Account + format settings */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Compte destination :</label>
          <select
            value={selectedAccount}
            onChange={(e) => onSelectAccount(e.target.value)}
            className="flex-1 text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
          >
            {accounts.length === 0
              ? <option value="">Aucun compte — créez-en un d'abord</option>
              : accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.bank_name})</option>)
            }
          </select>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Séparateur</label>
            <select value={delimiter} onChange={(e) => setDelimiter(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            >
              <option value=";">Point-virgule (;)</option>
              <option value=",">Virgule (,)</option>
              <option value="\t">Tabulation</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Encodage</label>
            <select value={encoding} onChange={(e) => setEncoding(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            >
              <option value="utf-8">UTF-8 (+ BOM auto)</option>
              <option value="latin-1">Latin-1 / ISO-8859-1</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Format date</label>
            <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
            >
              <option value="%d/%m/%Y">JJ/MM/AAAA</option>
              <option value="%Y-%m-%d">AAAA-MM-JJ</option>
              <option value="%m/%d/%Y">MM/JJ/AAAA</option>
              <option value="%d-%m-%Y">JJ-MM-AAAA</option>
              <option value="%d.%m.%Y">JJ.MM.AAAA</option>
            </select>
          </div>
        </div>
      </div>

      {/* Column mapping table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-600">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Colonnes détectées ({rawHeaders.length})
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-48">Colonne CSV</th>
                <th className="px-4 py-2 text-left text-xs text-gray-500 w-44">Correspond à</th>
                {rawPreview.slice(0, 3).map((_, i) => (
                  <th key={i} className="px-4 py-2 text-left text-xs text-gray-400">Exemple {i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawHeaders.map((header, colIdx) => (
                <tr key={colIdx} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{header}</td>
                  <td className="px-4 py-2">
                    <select
                      value={mapping[colIdx] || ''}
                      onChange={(e) => handleMapping(colIdx, e.target.value)}
                      className="w-full text-xs border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
                    >
                      <option value="">-- Choisir --</option>
                      {COLUMN_FIELD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  {rawPreview.slice(0, 3).map((row, i) => (
                    <td key={i} className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">
                      {row[colIdx] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live preview */}
      {localPreview.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-600">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Aperçu de la correspondance</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-gray-500">Date</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-500">Libellé</th>
                  <th className="px-4 py-2 text-right text-xs text-gray-500">Montant</th>
                </tr>
              </thead>
              <tbody>
                {localPreview.map((row, i) => (
                  <tr key={i} className="border-t border-gray-100 dark:border-slate-700">
                    <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400 font-mono">{row.date}</td>
                    <td className="px-4 py-2 text-xs text-gray-800 dark:text-gray-200 max-w-xs truncate">{row.description}</td>
                    <td className={`px-4 py-2 text-xs text-right font-medium ${row.amount.startsWith('−') ? 'text-red-500' : 'text-green-500'}`}>
                      {row.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Save profile option */}
      <div className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={saveProfile}
            onChange={(e) => setSaveProfile(e.target.checked)}
            className="rounded text-emerald-600"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Sauvegarder ce format pour les prochains imports</span>
        </label>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={() => {
            const acc = accounts.find(a => String(a.id) === selectedAccount)
            const profName = acc ? acc.bank_name : 'Unknown Bank'
            onConfirm(buildColumnMapping(), dateFormat, encoding, delimiter, profName, saveProfile)
          }}
          disabled={!isValid() || loading}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {loading ? 'Chargement…' : 'Continuer vers la prévisualisation →'}
        </button>
      </div>
    </div>
  )
}

// ── Import Review Step ────────────────────────────────────────────────────────

interface ImportReviewStepProps {
  transactions: ParsePreviewTransaction[]
  categories: Category[]
  accounts: Account[]
  selectedAccount: string
  onSelectAccount: (v: string) => void
  loading: boolean
  error: string
  onConfirm: (overrides: Record<string, number | null>, forceImportHashes?: string[]) => void
  onBack: () => void
}

function ImportReviewStep({
  transactions, categories, accounts, selectedAccount, onSelectAccount,
  loading, error, onConfirm, onBack,
}: ImportReviewStepProps) {
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [filterUncategorized, setFilterUncategorized] = useState(false)
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [forceImportHashes, setForceImportHashes] = useState<Set<string>>(new Set())

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]))

  const getCategoryId = (txn: ParsePreviewTransaction): number | null => {
    return txn.import_hash in overrides ? overrides[txn.import_hash] : txn.category_id
  }

  const duplicateTxns = transactions.filter(t => t.is_duplicate)
  const duplicates = duplicateTxns.length
  const forcedCount = duplicateTxns.filter(t => forceImportHashes.has(t.import_hash)).length
  const uncategorized = transactions.filter(t => (!t.is_duplicate || forceImportHashes.has(t.import_hash)) && getCategoryId(t) === null).length
  const toImport = transactions.filter(t => !t.is_duplicate).length + forcedCount

  const displayedTxns = filterUncategorized
    ? transactions.filter(t => (!t.is_duplicate || forceImportHashes.has(t.import_hash)) && getCategoryId(t) === null)
    : transactions.filter(t => !t.is_duplicate || forceImportHashes.has(t.import_hash))

  const canImport = toImport > 0 && !!selectedAccount

  const toggleForceImport = (hash: string) => {
    setForceImportHashes(prev => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  const toggleAllDuplicates = (include: boolean) => {
    if (include) {
      setForceImportHashes(new Set(duplicateTxns.map(t => t.import_hash)))
    } else {
      setForceImportHashes(new Set())
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Révision avant import</h2>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          ← Retour
        </button>
      </div>

      {/* Account selection */}
      <div className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-3">
        <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Compte destination :</label>
        <select
          value={selectedAccount}
          onChange={(e) => onSelectAccount(e.target.value)}
          className="flex-1 text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200"
        >
          {accounts.length === 0
            ? <option value="">Aucun compte — créez-en un d'abord</option>
            : accounts.map((a) => <option key={a.id} value={String(a.id)}>{a.name} ({a.bank_name})</option>)
          }
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{toImport}</p>
          <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">à importer</p>
        </div>
        <div className={`rounded-lg p-3 text-center ${uncategorized > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-gray-50 dark:bg-slate-800'}`}>
          <p className={`text-2xl font-bold ${uncategorized > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>{uncategorized}</p>
          <p className={`text-xs mt-0.5 ${uncategorized > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>non catégorisées</p>
        </div>
        <div
          className={`rounded-lg p-3 text-center cursor-pointer transition-colors ${duplicates > 0 ? 'bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30' : 'bg-gray-50 dark:bg-slate-800'}`}
          onClick={() => duplicates > 0 && setShowDuplicates(!showDuplicates)}
        >
          <p className={`text-2xl font-bold ${duplicates > 0 ? 'text-orange-500' : 'text-gray-400'}`}>{duplicates}</p>
          <p className={`text-xs mt-0.5 ${duplicates > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
            doublons {forceImportHashes.size > 0 ? `(${forceImportHashes.size} inclus)` : '· cliquer pour voir'}
          </p>
        </div>
      </div>

      {/* Duplicates panel */}
      {showDuplicates && duplicates > 0 && (
        <div className="border border-orange-200 dark:border-orange-800 rounded-xl overflow-hidden">
          <div className="bg-orange-50 dark:bg-orange-900/20 px-4 py-2.5 flex items-center justify-between">
            <p className="text-sm font-medium text-orange-700 dark:text-orange-400">
              {duplicates} doublon{duplicates > 1 ? 's' : ''} détecté{duplicates > 1 ? 's' : ''} (déjà importé{duplicates > 1 ? 's' : ''})
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => toggleAllDuplicates(forceImportHashes.size < duplicates)}
                className="text-xs px-2.5 py-1 rounded border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/30"
              >
                {forceImportHashes.size < duplicates ? 'Tout inclure' : 'Tout exclure'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-48">
            <table className="w-full text-sm">
              <tbody>
                {duplicateTxns.map((txn) => (
                  <tr key={txn.import_hash} className={`border-t border-orange-100 dark:border-orange-900/30 ${forceImportHashes.has(txn.import_hash) ? 'bg-green-50/50 dark:bg-green-900/10' : 'bg-white dark:bg-slate-900'}`}>
                    <td className="px-4 py-1.5 w-8">
                      <input
                        type="checkbox"
                        checked={forceImportHashes.has(txn.import_hash)}
                        onChange={() => toggleForceImport(txn.import_hash)}
                        className="rounded text-emerald-500"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 text-xs whitespace-nowrap">{txn.date}</td>
                    <td className="px-2 py-1.5 text-gray-800 dark:text-gray-200 text-xs truncate max-w-xs">{txn.description}</td>
                    <td className={`px-2 py-1.5 text-right text-xs font-medium whitespace-nowrap ${txn.is_debit ? 'text-red-500' : 'text-green-500'}`}>
                      {centsToEur(txn.amount_cents, txn.is_debit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
        <input
          type="checkbox"
          checked={filterUncategorized}
          onChange={(e) => setFilterUncategorized(e.target.checked)}
          className="rounded text-amber-500"
        />
        Afficher seulement les non catégorisées ({uncategorized})
      </label>

      {/* Color legend */}
      <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200 dark:bg-amber-900/40" /> Non catégorisée</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-200 dark:bg-green-900/40" /> Règle automatique</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-200 dark:bg-purple-900/40" /> Modèle ML</span>
      </div>

      {/* Table */}
      <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800 sticky top-0">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-600 dark:text-gray-400 w-24">Date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-600 dark:text-gray-400">Description</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-600 dark:text-gray-400 w-28">Montant</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-600 dark:text-gray-400 w-44">Catégorie</th>
              </tr>
            </thead>
            <tbody>
              {displayedTxns.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">
                    {filterUncategorized ? 'Toutes les transactions ont été catégorisées !' : 'Aucune transaction à importer.'}
                  </td>
                </tr>
              )}
              {displayedTxns.map((txn) => {
                const catId = getCategoryId(txn)
                const isUncategorized = catId === null
                return (
                  <tr key={txn.import_hash} className={`border-t border-gray-100 dark:border-slate-700 ${
                    isUncategorized
                      ? 'bg-amber-50/50 dark:bg-amber-900/10'
                      : txn.categorization_source === 'rule'
                      ? 'bg-green-50/50 dark:bg-green-900/10'
                      : txn.categorization_source === 'ml'
                      ? 'bg-purple-50/50 dark:bg-purple-900/10'
                      : ''
                  }`}>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{txn.date}</td>
                    <td className="px-4 py-2 text-gray-800 dark:text-gray-200 text-xs max-w-xs">
                      <span className="block truncate" title={txn.description}>{txn.description}</span>
                    </td>
                    <td className={`px-4 py-2 text-right text-xs font-medium whitespace-nowrap ${txn.is_debit ? 'text-red-500' : 'text-green-500'}`}>
                      {centsToEur(txn.amount_cents, txn.is_debit)}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={catId ?? ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setOverrides(prev => ({ ...prev, [txn.import_hash]: val ? parseInt(val) : null }))
                        }}
                        className={`w-full text-xs border rounded px-2 py-1 focus:ring-1 focus:ring-emerald-500 focus:outline-none ${
                          isUncategorized
                            ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                            : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200'
                        }`}
                      >
                        <option value="">Non catégorisé</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {uncategorized > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-400">
          ⚠ {uncategorized} transaction{uncategorized > 1 ? 's' : ''} non catégorisée{uncategorized > 1 ? 's' : ''}. Vous pouvez les corriger ci-dessus ou importer quand même.
        </div>
      )}

      {!selectedAccount && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          Sélectionnez un compte destination avant d'importer.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={() => onConfirm(overrides, Array.from(forceImportHashes))}
          disabled={loading || !canImport}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {loading ? 'Import en cours…' : `Importer ${toImport} transaction${toImport !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}

// ── Main Upload page ──────────────────────────────────────────────────────────

type Step = 'drop' | 'mapping' | 'review' | 'done'

export default function Upload() {
  const [step, setStep] = useState<Step>('drop')
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)  // force re-mount to allow same file re-select
  const [detected, setDetected] = useState<DetectResponse | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Column mapping params
  const [columnMapping, setColumnMapping] = useState<Record<string, string> | null>(null)
  const [dateFormat, setDateFormat] = useState('%d/%m/%Y')
  const [encoding, setEncoding] = useState('utf-8')
  const [delimiter, setDelimiter] = useState(';')

  // Review step
  const [previewTxns, setPreviewTxns] = useState<ParsePreviewTransaction[]>([])

  useEffect(() => {
    catApi.list().then(setCategories).catch(console.error)
  }, [])

  const loadAccounts = async () => {
    try {
      const accs = await accApi.list()
      setAccounts(accs)
      if (accs.length > 0 && !selectedAccount) setSelectedAccount(String(accs[0].id))
      return accs
    } catch (e) {
      console.error('[Upload] Failed to load accounts:', e)
      return []
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const f = files[0]
    if (!f.name.toLowerCase().endsWith('.csv') && f.type !== 'text/csv') {
      setError('Veuillez sélectionner un fichier CSV.')
      return
    }
    setFile(f)
    setError('')
    setLoading(true)
    try {
      await loadAccounts()
      const res = await uploadApi.detect(f)
      setDetected(res)
      if (res.detected && res.profile) {
        // Known bank — go straight to review
        await goToReview(f, res.profile.id, null, null, null, null)
      } else {
        // Unknown bank — show column mapping
        setStep('mapping')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur de détection'
      console.error('[Upload] handleFiles error:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const goToReview = async (
    f: File,
    profileId?: number,
    mapping?: Record<string, string> | null,
    fmt?: string | null,
    enc?: string | null,
    delim?: string | null,
  ) => {
    setLoading(true)
    setError('')
    try {
      const res = await uploadApi.parsePreview(
        f, profileId,
        mapping ?? undefined,
        fmt ?? undefined,
        enc ?? undefined,
        delim ?? undefined,
      )
      setPreviewTxns(res.transactions)
      setStep('review')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur de prévisualisation'
      console.error('[Upload] goToReview error:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleMappingConfirm = async (
    mapping: Record<string, string>,
    fmt: string,
    enc: string,
    delim: string,
    profName: string,
    shouldSave: boolean,
  ) => {
    if (!file) return
    setColumnMapping(mapping)
    setDateFormat(fmt)
    setEncoding(enc)
    setDelimiter(delim)
    setLoading(true)
    setError('')

    // Save profile if requested
    if (shouldSave && profName.trim()) {
      try {
        await uploadApi.saveProfile({
          name: profName.trim(),
          column_mapping: mapping,
          date_format: fmt,
          encoding: enc,
          delimiter: delim,
          detection_fingerprint: { columns: Object.values(mapping) },
        })
        console.log('[Upload] Profile saved:', profName)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erreur lors de la sauvegarde du profil'
        console.warn('[Upload] Failed to save profile:', msg)
        // Non-blocking — proceed with import anyway
        setError(`Profil non sauvegardé : ${msg}. L'import continue.`)
      }
    }

    await goToReview(file, undefined, mapping, fmt, enc, delim)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConfirm = async (overrides: Record<string, number | null>, forceImportHashes?: string[]) => {
    if (!file) return
    if (!selectedAccount) {
      setError('Veuillez sélectionner un compte destination.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const profileId = detected?.profile?.id
      const res = await uploadApi.confirm(
        file,
        parseInt(selectedAccount),
        profileId,
        columnMapping ?? undefined,
        columnMapping ? dateFormat : undefined,
        columnMapping ? encoding : undefined,
        columnMapping ? delimiter : undefined,
        overrides,
        forceImportHashes,
      )
      setResult(res)
      setStep('done')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors de l'import"
      console.error('[Upload] handleConfirm error:', msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setStep('drop')
    setFile(null)
    setFileInputKey(k => k + 1)  // re-mount input so same file can be selected again
    setDetected(null)
    setResult(null)
    setError('')
    setColumnMapping(null)
    setPreviewTxns([])
  }

  // ── Done step ──
  if (step === 'done' && result) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Import terminé</h2>
        <p className="text-gray-500 mb-1">{result.imported} transaction{result.imported !== 1 ? 's' : ''} importée{result.imported !== 1 ? 's' : ''}</p>
        <p className="text-gray-400 text-sm">{result.skipped} doublon{result.skipped !== 1 ? 's' : ''} ignoré{result.skipped !== 1 ? 's' : ''}</p>
        <button
          onClick={reset}
          className="mt-8 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
        >
          Importer un autre fichier
        </button>
      </div>
    )
  }

  // ── Column mapping step ──
  if (step === 'mapping' && detected && file) {
    return (
      <ColumnMappingStep
        rawHeaders={detected.raw_headers}
        rawPreview={detected.raw_preview}
        file={file}
        accounts={accounts}
        selectedAccount={selectedAccount}
        onSelectAccount={setSelectedAccount}
        onConfirm={handleMappingConfirm}
        onBack={reset}
        loading={loading}
        error={error}
      />
    )
  }

  // ── Review step ──
  if (step === 'review' && file) {
    return (
      <ImportReviewStep
        transactions={previewTxns}
        categories={categories}
        accounts={accounts}
        selectedAccount={selectedAccount}
        onSelectAccount={setSelectedAccount}
        loading={loading}
        error={error}
        onConfirm={handleConfirm}
        onBack={() => {
          setError('')
          if (detected && !detected.detected) {
            setStep('mapping')
          } else {
            reset()
          }
        }}
      />
    )
  }

  // ── Drop step ──
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">Importer des transactions</h2>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-16 text-center transition-colors ${
          dragging
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
            : 'border-gray-300 dark:border-slate-600 hover:border-emerald-400'
        }`}
      >
        <div className="text-4xl mb-4">📂</div>
        <p className="text-gray-600 dark:text-gray-400 mb-2">
          Glissez-déposez votre fichier CSV bancaire ici
        </p>
        <p className="text-sm text-gray-400 mb-4">ou</p>
        <label className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium cursor-pointer transition-colors">
          Sélectionner un fichier
          <input
            key={fileInputKey}
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
        <p className="text-xs text-gray-400 mt-4">
          Format CSV de n'importe quelle banque — UBS, PostFinance, Revolut, BNP, etc.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
          <span className="ml-3 text-gray-500">Analyse du fichier…</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  )
}
