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
}

function centsToEur(cents: number): string {
  return `${(Math.abs(cents) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

const COL_STATE_KEY = 'txn-col-state'

export default function TransactionTable({ data, categories, accounts, onUpdated, exportUrl }: Props) {
  const gridRef = useRef<AgGridReact>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkCatId, setBulkCatId] = useState('')

  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])
  const catColorMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.color])), [categories])

  const columnDefs: ColDef[] = useMemo(() => [
    {
      field: 'date',
      headerName: 'Date',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      width: 140,
      sortable: true,
      filter: 'agDateColumnFilter',
      floatingFilter: true,
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
      filter: 'agSetColumnFilter',
      floatingFilter: true,
      filterParams: {
        values: accounts.map(a => a.name),
      },
      valueFormatter: ({ value }) => value ?? '—',
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 2,
      sortable: true,
      filter: 'agTextColumnFilter',
      floatingFilter: true,
      tooltipField: 'description',
      cellRenderer: ({ data: row, value }: { data: Transaction; value: string }) => {
        if (!row) return value
        if (row.is_internal_transfer) {
          return (
            <span className="flex items-center gap-1.5">
              <span title="Virement interne" className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium flex-shrink-0">
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
        return row.is_debit ? `-${centsToEur(value)}` : `+${centsToEur(value)}`
      },
      filterParams: {
        numberParser: (text: string) => {
          if (text == null) return null
          return parseFloat(text.replace(',', '.').replace(/[^0-9.\-]/g, '')) * 100
        },
      },
      cellClass: ({ data: row }) => {
        if (!row) return ''
        if (row.is_internal_transfer) return 'text-blue-500 font-medium'
        return row.is_debit ? 'text-red-500 font-medium' : 'text-green-500 font-medium'
      },
    },
    {
      field: 'category_id',
      headerName: 'Catégorie',
      width: 170,
      editable: true,
      singleClickEdit: true,
      cellEditor: 'agSelectCellEditor',
      cellEditorParams: {
        values: ['', ...categories.map((c) => String(c.id))],
      },
      filter: 'agSetColumnFilter',
      floatingFilter: true,
      filterParams: {
        values: [null, ...categories.map(c => c.id)],
        valueFormatter: (params: { value: number | null }) => {
          if (!params.value) return 'Non catégorisé'
          return catMap[params.value]?.name || 'Non catégorisé'
        },
      },
      valueFormatter: ({ value }) => {
        if (!value) return 'Non catégorisé'
        return catMap[value]?.name || 'Non catégorisé'
      },
      cellRenderer: ({ value }: { value: number | null }) => {
        const cat = value ? catMap[value] : null
        return (
          <span className="flex items-center gap-1.5 cursor-pointer">
            {cat && (
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: cat.color }}
              />
            )}
            <span>{cat?.name || 'Non catégorisé'}</span>
          </span>
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
      width: 90,
      filter: false,
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
      const update: Record<string, unknown> = {}
      const field = colDef.field as string
      if (field === 'category_id') {
        const newCatId = newValue ? parseInt(newValue) : null
        update.category_id = newCatId
        // Update in-place
        row.category_id = newCatId
        gridRef.current?.api.applyTransaction({ update: [row] })
      } else if (field === 'is_manually_reviewed') {
        return
      } else {
        update[field] = newValue
      }
      await txnApi.update(row.id, update)
    } catch (err) {
      console.error('Update failed:', err)
    }
  }, [])

  // Column state persistence — save on resize, sort, filter, column move, and column visibility
  const saveColumnState = useCallback(() => {
    const state = gridRef.current?.api.getColumnState()
    if (state) localStorage.setItem(COL_STATE_KEY, JSON.stringify(state))
  }, [])

  const restoreColumnState = useCallback(() => {
    const saved = localStorage.getItem(COL_STATE_KEY)
    if (saved) {
      try {
        gridRef.current?.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true })
      } catch { /* ignore */ }
    }
  }, [])

  // Bulk category assignment
  const handleBulkCategory = useCallback(async (catIdStr: string) => {
    const categoryId = catIdStr === '' ? null : parseInt(catIdStr)
    try {
      await txnApi.bulkUpdateCategory(selectedIds, categoryId)
      setSelectedIds([])
      setBulkCatId('')
      onUpdated()
    } catch (err) {
      console.error('Bulk category update failed:', err)
    }
  }, [selectedIds, onUpdated])

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex justify-between items-center bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg p-2">
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 && (
            <>
              <span className="text-sm text-gray-500 dark:text-slate-400 font-medium">
                {selectedIds.length} sélectionnée{selectedIds.length > 1 ? 's' : ''}
              </span>
              <select
                value={bulkCatId}
                onChange={(e) => handleBulkCategory(e.target.value)}
                className="text-sm border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="" disabled>Catégoriser…</option>
                <option value="">Non catégorisé</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
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
            </>
          )}
        </div>
        {exportUrl && (
          <a
            href={exportUrl}
            download="transactions.csv"
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Exporter CSV
          </a>
        )}
      </div>
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
          onFilterChanged={saveColumnState}
          onColumnMoved={saveColumnState}
          onColumnVisible={saveColumnState}
          onGridReady={restoreColumnState}
          rowSelection="multiple"
          suppressRowClickSelection
          onSelectionChanged={() => {
            const nodes = gridRef.current?.api.getSelectedNodes() || []
            setSelectedIds(nodes.map(n => n.data?.id).filter(Boolean) as number[])
          }}
          pagination
          paginationPageSize={50}
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
    </div>
  )
}
