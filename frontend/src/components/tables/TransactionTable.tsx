import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, CellValueChangedEvent, ColumnResizedEvent } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { format } from 'date-fns'
import { transactions as txnApi } from '../../api/client'
import type { Transaction, Category, Account } from '../../types'

interface Props {
  data: Transaction[]
  categories: Category[]
  accounts: Account[]
  onUpdated: () => void
  exportUrl?: string
  selectAll?: boolean
}

import { formatCents } from '../../utils/currency'

// CategoryCellEditor removed — category selection is now handled directly in the cellRenderer


const COL_STATE_KEY = 'txn-col-state-v2'
const FILTER_STATE_KEY = 'txn-filter-state'

export default function TransactionTable({ data, categories, accounts, onUpdated, exportUrl, selectAll }: Props) {
  const gridRef = useRef<AgGridReact>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkCatId, setBulkCatId] = useState('')
  const [popoverCell, setPopoverCell] = useState<{text: string, x: number, y: number} | null>(null)

  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const catColorMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.color])), [categories])

  // Auto-select all rows when selectAll prop is true
  useEffect(() => {
    if (selectAll && gridRef.current?.api) {
      setTimeout(() => gridRef.current?.api.selectAll(), 100)
    }
  }, [selectAll, data])

  const columnDefs: ColDef[] = useMemo(() => [
    {
      field: 'date',
      headerName: 'Date',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      headerCheckboxSelectionFilteredOnly: true,
      width: 160,
      sortable: true,
      filter: 'agDateColumnFilter',
      floatingFilter: true,
      cellClass: 'selectable-cell',
      valueFormatter: ({ value }) => {
        try { return format(new Date(value), 'dd/MM/yyyy') } catch { return value }
      },
      filterParams: {
        comparator: (filterDate: Date, cellValue: string) => {
          const cellDate = new Date(cellValue)
          if (cellDate < filterDate) return -1
          if (cellDate > filterDate) return 1
          return 0
        },
      },
    },
    {
      field: 'account_name',
      headerName: 'Compte',
      width: 130,
      sortable: true,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      cellClass: 'selectable-cell',
      valueFormatter: ({ value }) => value ?? '—',
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 2,
      sortable: true,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      cellClass: 'selectable-cell',
      tooltipField: 'description',
      cellRenderer: ({ data: row, value }: { data: Transaction; value: string }) => {
        if (!row) return value
        if (row.is_internal_transfer) {
          return (
            <span className="flex items-center gap-1.5">
              <span
                title="Cliquer pour retirer le marquage virement interne"
                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium flex-shrink-0 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/40"
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    await txnApi.update(row.id, { is_internal_transfer: false })
                    row.is_internal_transfer = false
                    gridRef.current?.api.applyTransaction({ update: [row] })
                  } catch (err) {
                    console.error('Update failed:', err)
                  }
                }}
              >
                ⇄
              </span>
              <span>{value}</span>
            </span>
          )
        }
        return value
      },
    },
    {
      field: 'amount_cents',
      headerName: 'Montant',
      width: 130,
      sortable: true,
      filter: 'agNumberColumnFilter',
      floatingFilter: true,
      valueFormatter: ({ data: row, value }) => {
        if (!row) return ''
        const amt = formatCents(value, row.currency || 'EUR', { decimals: 2 })
        return row.is_debit ? `-${amt}` : `+${amt}`
      },
      filterParams: {
        numberParser: (text: string) => {
          if (text == null) return null
          return parseFloat(text.replace(',', '.').replace(/[^0-9.\-]/g, '')) * 100
        },
      },
      cellClass: ({ data: row }) => {
        if (!row) return 'selectable-cell'
        const base = 'selectable-cell '
        if (row.is_internal_transfer) return base + 'text-blue-500 font-medium'
        return base + (row.is_debit ? 'text-red-500 font-medium' : 'text-green-500 font-medium')
      },
    },
    {
      field: 'category_id',
      headerName: 'Catégorie',
      width: 200,
      editable: false,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      filterValueGetter: (params: { data: Transaction }) => {
        if (!params.data) return ''
        const cid = params.data.category_id
        const cat = cid != null ? catMap[cid] : null
        return cat?.name || 'Non catégorisé'
      },
      cellRenderer: ({ data: row, value }: { data: Transaction; value: number | null }) => {
        if (!row) return null
        const txnAccountId = row.account_id ?? null
        const accountCats = categories.filter(c => c.account_id === txnAccountId)
        const globalCats = categories.filter(c => c.account_id === null)
        const groupByType = (cs: Category[]) => ({
          revenus: cs.filter(c => c.is_income),
          fixes: cs.filter(c => !c.is_income && c.expense_type === 'fixed'),
          variables: cs.filter(c => !c.is_income && c.expense_type === 'variable'),
          autres: cs.filter(c => !c.is_income && c.expense_type !== 'fixed' && c.expense_type !== 'variable'),
        })
        const acctG = groupByType(accountCats)
        const globG = groupByType(globalCats)
        const accountName = accounts.find(a => a.id === txnAccountId)?.name
        const renderOpts = (label: string, cs: Category[]) =>
          cs.length > 0 ? <optgroup key={label} label={label}>{cs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup> : null
        return (
          <select
            value={value ?? ''}
            onChange={async (e) => {
              const newCatId = e.target.value ? parseInt(e.target.value) : null
              row.category_id = newCatId
              try {
                await txnApi.update(row.id, { category_id: newCatId })
              } catch (err) {
                console.error('Category update failed:', err)
              }
              const rowNode = gridRef.current?.api.getRowNode(String(row.id))
              if (rowNode) {
                gridRef.current?.api.refreshCells({ rowNodes: [rowNode], force: true })
                gridRef.current?.api.redrawRows({ rowNodes: [rowNode] })
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full h-full text-xs bg-transparent border-0 outline-none cursor-pointer text-gray-900 dark:text-white py-0"
          >
            <option value="">Non catégorisé</option>
            {accountCats.length > 0 && accountName && (
              <>
                {renderOpts(`${accountName} · Revenus`, acctG.revenus)}
                {renderOpts(`${accountName} · Dép. fixes`, acctG.fixes)}
                {renderOpts(`${accountName} · Dép. variables`, acctG.variables)}
                {renderOpts(`${accountName} · Autre`, acctG.autres)}
              </>
            )}
            {renderOpts('Revenus', globG.revenus)}
            {renderOpts('Dépenses fixes', globG.fixes)}
            {renderOpts('Dépenses variables', globG.variables)}
            {renderOpts('Autre', globG.autres)}
          </select>
        )
      },
    },
    {
      field: 'notes',
      headerName: 'Notes',
      flex: 1,
      editable: true,
      singleClickEdit: true,
      cellEditor: 'agTextCellEditor',
      filter: 'agTextColumnFilter',
      floatingFilter: true,
    },
    {
      field: 'is_manually_reviewed',
      headerName: 'Vérifié',
      width: 110,
      filter: true,
      floatingFilter: true,
      cellRenderer: ({ data: row, value }: { data: Transaction; value: boolean }) => {
        if (!row) return null
        return (
          <div
            className="flex items-center justify-center h-full cursor-pointer"
            onClick={async (e) => {
              e.stopPropagation()
              try {
                await txnApi.update(row.id, { is_manually_reviewed: !value })
                // Update in-place via grid API instead of reloading
                row.is_manually_reviewed = !value
                gridRef.current?.api.applyTransaction({ update: [row] })
              } catch (err) {
                console.error('Update failed:', err)
              }
            }}
          >
            <input
              type="checkbox"
              checked={value}
              readOnly
              className="w-4 h-4 accent-emerald-600 cursor-pointer pointer-events-none"
            />
          </div>
        )
      },
    },
  ], [categories, catMap, accounts])

  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent) => {
    const { data: row, colDef, newValue } = event
    if (!row) return
    try {
      const field = colDef.field as string
      if (field === 'category_id' || field === 'is_manually_reviewed') {
        // category is handled directly in cellRenderer, reviewed in its own cellRenderer
        return
      }
      await txnApi.update(row.id, { [field]: newValue })
    } catch (err) {
      console.error('Update failed:', err)
    }
  }, [])

  // Column + filter state persistence
  const saveColumnState = useCallback(() => {
    const state = gridRef.current?.api.getColumnState()
    if (state) localStorage.setItem(COL_STATE_KEY, JSON.stringify(state))
  }, [])

  const saveFilterState = useCallback(() => {
    const filterModel = gridRef.current?.api.getFilterModel()
    if (filterModel) localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(filterModel))
  }, [])

  const restoreColumnState = useCallback(() => {
    const saved = localStorage.getItem(COL_STATE_KEY)
    if (saved) {
      try {
        gridRef.current?.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true })
      } catch { /* ignore */ }
    }
    const savedFilters = localStorage.getItem(FILTER_STATE_KEY)
    if (savedFilters) {
      try {
        gridRef.current?.api.setFilterModel(JSON.parse(savedFilters))
      } catch { /* ignore */ }
    }
  }, [])

  // Bulk category assignment
  const handleBulkCategory = useCallback(async () => {
    const categoryId = bulkCatId === '' || bulkCatId === '__uncategorized__' ? null : parseInt(bulkCatId)
    try {
      await txnApi.bulkUpdateCategory(selectedIds, categoryId)
      setSelectedIds([])
      setBulkCatId('')
      onUpdated()
    } catch (err) {
      console.error('Bulk category update failed:', err)
    }
  }, [selectedIds, bulkCatId, onUpdated])

  return (
    <div className="flex flex-col h-full gap-2">
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
          <span className="text-sm text-gray-500 dark:text-slate-400 font-medium">
            {selectedIds.length} sélectionnée{selectedIds.length > 1 ? 's' : ''}
          </span>
          <button
            onClick={() => {
              setSelectedIds([])
              setBulkCatId('')
              gridRef.current?.api.deselectAll()
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 font-medium transition-colors hover:bg-gray-200 dark:hover:bg-slate-600"
          >
            Annuler
          </button>
          <select
            value={bulkCatId}
            onChange={(e) => setBulkCatId(e.target.value)}
            className="text-sm border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          >
            <option value="" disabled>Catégoriser…</option>
            <option value="__uncategorized__">Non catégorisé</option>
            <optgroup label="Revenus">
              {categories.filter(c => c.is_income).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <optgroup label="Dépenses fixes">
              {categories.filter(c => !c.is_income && c.expense_type === 'fixed').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            <optgroup label="Dépenses variables">
              {categories.filter(c => !c.is_income && c.expense_type === 'variable').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            {categories.filter(c => !c.is_income && c.expense_type !== 'fixed' && c.expense_type !== 'variable').length > 0 && (
              <optgroup label="Autre">
                {categories.filter(c => !c.is_income && c.expense_type !== 'fixed' && c.expense_type !== 'variable').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
          {bulkCatId !== '' && (
            <button
              onClick={handleBulkCategory}
              className="text-sm px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
            >
              Valider
            </button>
          )}
          <button
            onClick={async () => {
              try {
                await txnApi.bulkUpdateReviewed(selectedIds, true)
                setSelectedIds([])
                gridRef.current?.api.deselectAll()
                onUpdated()
              } catch (e) {
                console.error('Failed to verify transactions', e)
              }
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium transition-colors hover:bg-blue-200 dark:hover:bg-blue-900/50"
          >
            Vérifier
          </button>
          <button
            onClick={async () => {
              try {
                await txnApi.bulkUpdateTransfer(selectedIds, true)
                setSelectedIds([])
                gridRef.current?.api.deselectAll()
                onUpdated()
              } catch (e) {
                console.error('Failed to mark transfers', e)
              }
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium transition-colors hover:bg-indigo-200 dark:hover:bg-indigo-900/50"
          >
            ⇄ Transfert
          </button>
          <button
            onClick={async () => {
              try {
                await txnApi.bulkUpdateTransfer(selectedIds, false)
                setSelectedIds([])
                gridRef.current?.api.deselectAll()
                onUpdated()
              } catch (e) {
                console.error('Failed to unmark transfers', e)
              }
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 font-medium transition-colors hover:bg-gray-200 dark:hover:bg-slate-600"
          >
            ⇄ Pas transfert
          </button>
          <button
            onClick={async () => {
              if (confirm(`Voulez-vous vraiment supprimer ${selectedIds.length} transactions ?`)) {
                try {
                  await txnApi.bulkDelete(selectedIds)
                  setSelectedIds([])
                  onUpdated()
                } catch (e) {
                  console.error('Failed to delete transactions', e)
                }
              }
            }}
            className="text-sm px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium transition-colors hover:bg-red-200 dark:hover:bg-red-900/50"
          >
            Supprimer
          </button>
        </div>
      )}
      <div className="ag-theme-alpine dark:ag-theme-alpine flex-1" style={{ minHeight: 400 }}>
        <AgGridReact
          ref={gridRef}
          rowData={data}
          columnDefs={columnDefs}
          getRowId={(params) => String(params.data.id)}
          defaultColDef={{
            resizable: true,
            sortable: true,
          }}
          onCellValueChanged={onCellValueChanged}
          onColumnResized={(e: ColumnResizedEvent) => { if (e.finished) saveColumnState() }}
          onSortChanged={saveColumnState}
          onFilterChanged={() => { saveColumnState(); saveFilterState() }}
          onColumnMoved={saveColumnState}
          onColumnVisible={saveColumnState}
          onGridReady={restoreColumnState}
          rowSelection="multiple"
          suppressRowClickSelection
          onSelectionChanged={() => {
            const nodes = gridRef.current?.api.getSelectedNodes() || []
            setSelectedIds(nodes.map(n => n.data?.id).filter(Boolean) as number[])
          }}
          onCellClicked={(event) => {
            // Skip popover for editable columns — let AG Grid handle editing
            const field = event.colDef?.field
            if (field === 'category_id' || field === 'notes' || field === 'is_manually_reviewed') return
            const el = event.event?.target as HTMLElement
            if (el && el.scrollWidth > el.clientWidth) {
              const rect = el.getBoundingClientRect()
              setPopoverCell({
                text: event.value?.toString() || '',
                x: rect.left,
                y: rect.bottom + 4,
              })
            }
          }}
          pagination
          paginationPageSize={200}
          animateRows
          tooltipShowDelay={300}
          getRowStyle={({ data: row }: { data: any }) => {
            if (!row) return undefined
            if (row.is_internal_transfer) return { opacity: 0.75 } as any
            const color = catColorMap[row.category_id]
            if (color) return { backgroundColor: `${color}15` } as any
            return undefined
          }}
        />
      </div>

      {/* Popover for truncated cell content */}
      {popoverCell && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setPopoverCell(null)}
        >
          <div
            className="absolute z-50 max-w-md p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg text-sm text-gray-900 dark:text-white break-words"
            style={{ left: popoverCell.x, top: popoverCell.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {popoverCell.text}
          </div>
        </div>
      )}
    </div>
  )
}
