import React, { useEffect, useState, useRef, useCallback } from 'react'
import { analytics, accounts as accApi } from '../api/client'
import type { BudgetFullResponse, BudgetTableRow, BudgetTableCell, Account } from '../types'

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function centsToDisplay(cents: number): string {
  if (cents === 0) return '0,0 \u20ac'
  const abs = Math.abs(cents)
  const formatted = (abs / 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return cents < 0 ? `-${formatted} \u20ac` : `${formatted} \u20ac`
}

const MONTH_NAMES: Record<string, string> = {
  '01': 'Jan', '02': 'Fév', '03': 'Mar', '04': 'Avr',
  '05': 'Mai', '06': 'Juin', '07': 'Juil', '08': 'Août',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Déc',
}

function formatMonthShort(m: string): string {
  const [, mo] = m.split('-')
  return MONTH_NAMES[mo] ?? mo
}

function formatMonthYear(m: string): string {
  const [yr, mo] = m.split('-')
  return `${MONTH_NAMES[mo] ?? mo} ${yr}`
}

function yearOf(m: string): string {
  return m.split('-')[0]
}

/** Build 24-month range: 12 past + current + 11 future */
function build24Months(): string[] {
  const now = new Date()
  const months: string[] = []
  for (let offset = -12; offset <= 11; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

/** Compute the displayed value for a cell */
function cellDisplayValue(cell: BudgetTableCell, currentMonth: string): number {
  const month = cell.month
  if (month > currentMonth) {
    // Future month: only manual expected
    return cell.expected_cents
  }
  // Past or current month: actual + manual override
  return cell.actual_cents + cell.expected_cents
}

const SECTION_STYLES: Record<string, { headerBg: string; headerText: string; totalBg: string; totalText: string }> = {
  revenus: {
    headerBg: 'bg-emerald-700',
    headerText: 'text-white',
    totalBg: 'bg-emerald-50 dark:bg-emerald-900/20',
    totalText: 'text-emerald-800 dark:text-emerald-300',
  },
  depenses_fixes: {
    headerBg: 'bg-rose-800',
    headerText: 'text-white',
    totalBg: 'bg-rose-50 dark:bg-rose-900/20',
    totalText: 'text-rose-800 dark:text-rose-300',
  },
  depenses_variables: {
    headerBg: 'bg-blue-700',
    headerText: 'text-white',
    totalBg: 'bg-blue-50 dark:bg-blue-900/20',
    totalText: 'text-blue-800 dark:text-blue-300',
  },
}

/* ── Pencil icon (SVG inline) ──────────────────────────────────────────────── */

function PencilDot() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="inline-block w-3 h-3 text-amber-500 dark:text-amber-400 ml-1 flex-shrink-0"
      aria-hidden="true"
    >
      <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-9.5 9.5a.5.5 0 0 1-.168.11l-4 1.5a.5.5 0 0 1-.638-.638l1.5-4a.5.5 0 0 1 .11-.168l9.5-9.5ZM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5Zm1.586 3-2.293-2.293L3 10.707V11h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l7.5-7.5Z" />
    </svg>
  )
}

/* ── Merge two BudgetFullResponse objects ───────────────────────────────────── */

interface MergedCell {
  month: string
  actual_cents: number
  expected_cents: number
}

interface MergedRow {
  category_id: number | null
  category_name: string
  category_color: string
  cells: MergedCell[]
}

interface MergedSection {
  section: string
  section_label: string
  rows: MergedRow[]
  section_totals: MergedRow
}

interface MergedData {
  months: string[]
  sections: MergedSection[]
  reste_row: MergedRow
  grand_total_row: MergedRow
}

function mergeYears(
  responses: BudgetFullResponse[],
  targetMonths: string[],
): MergedData {
  // Build a lookup: "year" -> response
  const byYear = new Map<string, BudgetFullResponse>()
  for (const r of responses) {
    if (r.months.length > 0) {
      const yr = yearOf(r.months[0])
      byYear.set(yr, r)
    }
  }

  // For each target month, find which response+index has data
  function findCell(row: BudgetTableRow | undefined, resp: BudgetFullResponse | undefined, month: string): MergedCell {
    if (!resp || !row) return { month, actual_cents: 0, expected_cents: 0 }
    const idx = resp.months.indexOf(month)
    if (idx === -1 || idx >= row.cells.length) return { month, actual_cents: 0, expected_cents: 0 }
    const c = row.cells[idx]
    return { month, actual_cents: c.actual_cents, expected_cents: c.expected_cents }
  }

  function mergeRow(getRow: (resp: BudgetFullResponse) => BudgetTableRow | undefined, fallbackName: string, fallbackColor: string): MergedRow {
    const cells: MergedCell[] = targetMonths.map((m) => {
      const yr = yearOf(m)
      const resp = byYear.get(yr)
      const row = resp ? getRow(resp) : undefined
      return findCell(row, resp, m)
    })
    // Get name/color from first available
    let name = fallbackName
    let color = fallbackColor
    let catId: number | null = null
    for (const resp of responses) {
      const row = getRow(resp)
      if (row) {
        name = row.category_name
        color = row.category_color
        catId = row.category_id
        break
      }
    }
    return { category_id: catId, category_name: name, category_color: color, cells }
  }

  // Merge sections — assume same sections exist in all responses
  const sectionKeys: string[] = []
  const sectionLabels = new Map<string, string>()
  for (const resp of responses) {
    for (const s of resp.sections) {
      if (!sectionKeys.includes(s.section)) {
        sectionKeys.push(s.section)
        sectionLabels.set(s.section, s.section_label)
      }
    }
  }

  const sections: MergedSection[] = sectionKeys.map((sKey) => {
    // Collect all category rows across responses for this section
    const catIds = new Map<number | string, { id: number | null; name: string; color: string }>()
    for (const resp of responses) {
      const sec = resp.sections.find((s) => s.section === sKey)
      if (!sec) continue
      for (const row of sec.rows) {
        const key = row.category_id ?? row.category_name
        if (!catIds.has(key)) {
          catIds.set(key, { id: row.category_id, name: row.category_name, color: row.category_color })
        }
      }
    }

    const rows: MergedRow[] = Array.from(catIds.entries()).map(([key, info]) => {
      return mergeRow(
        (resp) => {
          const sec = resp.sections.find((s) => s.section === sKey)
          return sec?.rows.find((r) => (r.category_id ?? r.category_name) === key)
        },
        info.name,
        info.color,
      )
    })

    const sectionTotals = mergeRow(
      (resp) => resp.sections.find((s) => s.section === sKey)?.section_totals,
      `TOTAL ${sectionLabels.get(sKey) ?? sKey}`,
      '',
    )

    return {
      section: sKey,
      section_label: sectionLabels.get(sKey) ?? sKey,
      rows,
      section_totals: sectionTotals,
    }
  })

  const reste_row = mergeRow((resp) => resp.reste_row, 'RESTE', '')
  const grand_total_row = mergeRow((resp) => resp.grand_total_row, 'SOLDE NET', '')

  return { months: targetMonths, sections, reste_row, grand_total_row }
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function Budget() {
  const [data, setData] = useState<MergedData | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [editingCell, setEditingCell] = useState<{ sectionIdx: number; rowIdx: number; monthIdx: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const currentMonthRef = useRef<HTMLTableCellElement>(null)

  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  const targetMonths = React.useMemo(() => build24Months(), [])
  const yearsNeeded = React.useMemo(() => {
    const yrs = new Set(targetMonths.map(yearOf))
    return Array.from(yrs).map(Number).sort()
  }, [targetMonths])

  const load = useCallback(() => {
    setLoading(true)
    const budgetCalls = yearsNeeded.map((yr) => analytics.budgetFull(yr, accountId))
    Promise.all([...budgetCalls, accApi.list()])
      .then((results) => {
        const accs = results[results.length - 1] as Account[]
        const budgetResults = results.slice(0, -1) as BudgetFullResponse[]
        const merged = mergeYears(budgetResults, targetMonths)
        setData(merged)
        setAccounts(accs)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId, yearsNeeded, targetMonths])

  useEffect(() => { load() }, [load])

  // Auto-scroll to current month on first load
  useEffect(() => {
    if (!loading && data && currentMonthRef.current && scrollRef.current) {
      const container = scrollRef.current
      const cell = currentMonthRef.current
      const containerRect = container.getBoundingClientRect()
      const cellRect = cell.getBoundingClientRect()
      const scrollLeft = cellRect.left - containerRect.left + container.scrollLeft - containerRect.width / 2 + cellRect.width / 2
      container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' })
    }
  }, [loading, data])

  const handleCellClick = (sectionIdx: number, row: MergedRow, rowIdx: number, monthIdx: number) => {
    if (row.category_id === null) return
    setEditingCell({ sectionIdx, rowIdx, monthIdx })
    const existing = row.cells[monthIdx].expected_cents
    setEditValue(existing !== 0 ? String(existing / 100) : '')
  }

  const handleSaveCell = async (row: MergedRow, monthIdx: number) => {
    if (!editingCell || !data || row.category_id === null) return
    setSaving(true)
    try {
      const cents = Math.round(parseFloat(editValue.replace(',', '.') || '0') * 100)
      await analytics.upsertBudget(row.category_id, data.months[monthIdx], cents, accountId)
      load()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
      setEditingCell(null)
    }
  }

  const renderCellValue = (cents: number, isTotal = false) => {
    if (cents === 0) return <span className="text-gray-300 dark:text-slate-600">{isTotal ? '0,0 \u20ac' : '\u2014'}</span>
    return <span>{centsToDisplay(cents)}</span>
  }

  const renderRow = (row: MergedRow, sectionIdx: number, rowIdx: number, isSubItem = false) => {
    if (!data) return null
    const displayTotal = row.cells.reduce((sum, c) => sum + cellDisplayValue(c, currentMonth), 0)

    return (
      <tr key={`${sectionIdx}-${rowIdx}`} className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
        <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-4 py-2 border-r border-gray-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            {isSubItem && <div className="w-3" />}
            {row.category_color && (
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.category_color }} />
            )}
            <span className={`text-sm truncate max-w-40 ${isSubItem ? 'text-gray-600 dark:text-slate-400' : 'font-medium text-gray-800 dark:text-slate-200'}`} title={row.category_name}>
              {row.category_name}
            </span>
          </div>
        </td>
        {row.cells.map((cell, monthIdx) => {
          const month = cell.month
          const isCurrent = month === currentMonth
          const isFuture = month > currentMonth
          const isEditing = editingCell?.sectionIdx === sectionIdx && editingCell?.rowIdx === rowIdx && editingCell?.monthIdx === monthIdx
          const displayValue = cellDisplayValue(cell, currentMonth)
          const hasManual = cell.expected_cents !== 0

          return (
            <td
              key={monthIdx}
              onClick={() => handleCellClick(sectionIdx, row, rowIdx, monthIdx)}
              className={`px-2 py-2 text-right text-sm whitespace-nowrap cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800/40 ${
                isCurrent ? 'bg-emerald-50/40 dark:bg-emerald-900/10' : ''
              } ${isFuture ? 'bg-gray-50/50 dark:bg-slate-800/20' : ''} ${
                hasManual ? 'border-l-2 border-l-amber-400 dark:border-l-amber-500 bg-amber-50/30 dark:bg-amber-900/10' : ''
              }`}
            >
              {isEditing ? (
                <div className="flex items-center gap-1 justify-end">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveCell(row, monthIdx)
                      if (e.key === 'Escape') setEditingCell(null)
                    }}
                    className="w-20 text-sm border border-emerald-400 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900 text-right focus-ring"
                    autoFocus
                  />
                  <button onClick={() => handleSaveCell(row, monthIdx)} disabled={saving} className="text-emerald-600 text-sm font-bold" aria-label="Valider">
                    ✓
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-end">
                  {renderCellValue(displayValue)}
                  {hasManual && <PencilDot />}
                  {!hasManual && row.category_id !== null && displayValue === 0 && (
                    <span className="text-xs text-gray-300 dark:text-slate-600 ml-1">+</span>
                  )}
                </div>
              )}
            </td>
          )
        })}
        <td className="px-3 py-2 text-right text-sm font-semibold text-gray-800 dark:text-slate-200 border-l border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
          {renderCellValue(displayTotal, true)}
        </td>
      </tr>
    )
  }

  const renderTotalRow = (row: MergedRow, style: { totalBg: string; totalText: string }, label: string) => {
    if (!data) return null
    const displayTotal = row.cells.reduce((sum, c) => sum + cellDisplayValue(c, currentMonth), 0)

    return (
      <tr className={`${style.totalBg} font-bold border-b-2 border-gray-200 dark:border-slate-700`}>
        <td className={`sticky left-0 z-10 ${style.totalBg} px-4 py-2.5 text-sm ${style.totalText} border-r border-gray-200 dark:border-slate-700`}>
          {label}
        </td>
        {row.cells.map((cell, i) => {
          const displayValue = cellDisplayValue(cell, currentMonth)
          const hasManual = cell.expected_cents !== 0
          return (
            <td key={i} className={`px-2 py-2.5 text-right text-sm ${style.totalText} ${hasManual ? 'border-l-2 border-l-amber-400 dark:border-l-amber-500' : ''}`}>
              <div className="flex items-center justify-end">
                {renderCellValue(displayValue, true)}
                {hasManual && <PencilDot />}
              </div>
            </td>
          )
        })}
        <td className={`px-3 py-2.5 text-right text-sm ${style.totalText} border-l border-gray-200 dark:border-slate-700 bg-gray-50/30 dark:bg-slate-800/30`}>
          {renderCellValue(displayTotal, true)}
        </td>
      </tr>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    )
  }

  if (!data) {
    return <p className="text-gray-400 dark:text-slate-500 text-center py-12">Aucune donnée disponible.</p>
  }

  // Detect year boundaries for column group headers
  const yearSpans: { year: string; count: number }[] = []
  for (const m of data.months) {
    const yr = yearOf(m)
    if (yearSpans.length > 0 && yearSpans[yearSpans.length - 1].year === yr) {
      yearSpans[yearSpans.length - 1].count++
    } else {
      yearSpans.push({ year: yr, count: 1 })
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Budget</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            Cliquez sur une cellule pour saisir un ajustement manuel. Vue continue sur 24 mois.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Account filter */}
          <select
            value={accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value ? parseInt(e.target.value) : undefined)}
            className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 focus-ring"
            aria-label="Filtrer par compte"
          >
            <option value="">Tous les comptes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          {/* Legend */}
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5">
            <span className="inline-block w-3 h-3 border-l-2 border-l-amber-400 bg-amber-50/60 dark:bg-amber-900/20 rounded-sm" />
            <span>= ajustement manuel</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            {/* Year group row */}
            <tr className="bg-slate-900 dark:bg-black">
              <th className="sticky left-0 z-20 bg-slate-900 dark:bg-black border-r border-slate-700" rowSpan={2}>
                <div className="px-4 py-3 text-left text-sm font-bold text-white min-w-48">
                  {accountId ? accounts.find(a => a.id === accountId)?.name ?? 'Compte' : 'BUDGET'}
                </div>
              </th>
              {yearSpans.map((ys) => (
                <th
                  key={ys.year}
                  colSpan={ys.count}
                  className="px-2 py-1.5 text-center text-xs font-bold text-slate-400 border-l border-slate-700 tracking-wider"
                >
                  {ys.year}
                </th>
              ))}
              <th className="border-l border-slate-700 bg-slate-900 dark:bg-black" rowSpan={2}>
                <div className="px-3 py-3 text-right text-sm font-bold text-amber-400 min-w-28">
                  TOTAL
                </div>
              </th>
            </tr>
            {/* Month headers */}
            <tr className="bg-slate-800 dark:bg-slate-950">
              {data.months.map((m) => {
                const isCurrent = m === currentMonth
                return (
                  <th
                    key={m}
                    ref={isCurrent ? currentMonthRef : undefined}
                    className={`px-2 py-2 text-center text-xs font-semibold min-w-24 ${
                      isCurrent
                        ? 'text-emerald-400 bg-emerald-900/20 border-b-2 border-emerald-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {formatMonthShort(m)}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.sections.map((section, sIdx) => {
              const style = SECTION_STYLES[section.section] ?? SECTION_STYLES.depenses_variables
              return (
                <React.Fragment key={section.section}>
                  {/* Section header */}
                  <tr className={style.headerBg}>
                    <td colSpan={data.months.length + 2} className={`px-4 py-2 text-sm font-bold ${style.headerText} tracking-wide`}>
                      {section.section_label}
                    </td>
                  </tr>

                  {/* Category rows */}
                  {section.rows.map((row, rIdx) => renderRow(row, sIdx, rIdx, true))}

                  {/* Section total */}
                  {renderTotalRow(section.section_totals, style, `TOTAL ${section.section_label}`)}

                  {/* Reste row after fixed expenses */}
                  {section.section === 'depenses_fixes' && (
                    <tr className="bg-emerald-100 dark:bg-emerald-900/30 font-bold border-b-2 border-emerald-300 dark:border-emerald-800">
                      <td className="sticky left-0 z-10 bg-emerald-100 dark:bg-emerald-900/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300 border-r border-gray-200 dark:border-slate-700">
                        RESTE pour les dépenses variables
                      </td>
                      {data.reste_row.cells.map((cell, i) => {
                        const displayValue = cellDisplayValue(cell, currentMonth)
                        const hasManual = cell.expected_cents !== 0
                        return (
                          <td key={i} className={`px-2 py-3 text-right text-sm text-emerald-800 dark:text-emerald-300 font-bold ${hasManual ? 'border-l-2 border-l-amber-400' : ''}`}>
                            <div className="flex items-center justify-end">
                              {renderCellValue(displayValue, true)}
                              {hasManual && <PencilDot />}
                            </div>
                          </td>
                        )
                      })}
                      <td className="px-3 py-3 text-right text-sm text-emerald-800 dark:text-emerald-300 font-bold border-l border-gray-200 dark:border-slate-700">
                        {renderCellValue(data.reste_row.cells.reduce((sum, c) => sum + cellDisplayValue(c, currentMonth), 0), true)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}

            {/* Grand total row */}
            <tr className="bg-slate-800 dark:bg-slate-950 font-bold">
              <td className="sticky left-0 z-10 bg-slate-800 dark:bg-slate-950 px-4 py-3 text-sm text-white border-r border-slate-700">
                SOLDE NET
              </td>
              {data.grand_total_row.cells.map((cell, i) => {
                const displayValue = cellDisplayValue(cell, currentMonth)
                const isPositive = displayValue >= 0
                const hasManual = cell.expected_cents !== 0
                return (
                  <td key={i} className={`px-2 py-3 text-right text-sm font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'} ${hasManual ? 'border-l-2 border-l-amber-400' : ''}`}>
                    <div className="flex items-center justify-end">
                      {renderCellValue(displayValue, true)}
                      {hasManual && <PencilDot />}
                    </div>
                  </td>
                )
              })}
              <td className="px-3 py-3 text-right text-sm font-bold text-amber-400 border-l border-slate-700">
                {centsToDisplay(data.grand_total_row.cells.reduce((sum, c) => sum + cellDisplayValue(c, currentMonth), 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
