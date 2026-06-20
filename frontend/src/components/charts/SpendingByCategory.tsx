import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Sector } from 'recharts'
import { useState } from 'react'
import type { CategoryBreakdown } from '../../types'

import { formatCents } from '../../utils/currency'

interface Props {
  data: CategoryBreakdown[]
  currency?: string
}

const COLORS = [
  '#10b981', '#f97316', '#3b82f6', '#8b5cf6', '#ec4899',
  '#f59e0b', '#ef4444', '#06b6d4', '#22c55e', '#64748b',
  '#6366f1', '#84cc16', '#94a3b8',
]


const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props as {
    cx: number; cy: number; innerRadius: number; outerRadius: number
    startAngle: number; endAngle: number; fill: string
  }
  return (
    <g>
      <Sector
        cx={cx} cy={cy}
        innerRadius={innerRadius}
        outerRadius={(outerRadius as number) + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx} cy={cy}
        innerRadius={(innerRadius as number) - 4}
        outerRadius={innerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </g>
  )
}

const MAX_SLICES = 8

export default function SpendingByCategory({ data, currency = 'EUR' }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined)

  if (!data.length) {
    return <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-sm">Aucune donnée</div>
  }

  let chartData: Array<{ name: string; value: number; percentage: number; fill: string; category_id: number | null }>
  if (data.length > MAX_SLICES) {
    const main = data.slice(0, MAX_SLICES - 1)
    const rest = data.slice(MAX_SLICES - 1)
    const autresValue = rest.reduce((sum, d) => sum + d.total_cents, 0)
    const autresPct = rest.reduce((sum, d) => sum + d.percentage, 0)
    chartData = [
      ...main.map((d, i) => ({
        name: d.category_name,
        value: d.total_cents,
        percentage: d.percentage,
        fill: COLORS[i % COLORS.length],
        category_id: d.category_id,
      })),
      {
        name: 'Autres',
        value: autresValue,
        percentage: autresPct,
        fill: '#94a3b8',
        category_id: null,
      },
    ]
  } else {
    chartData = data.map((d, i) => ({
      name: d.category_name,
      value: d.total_cents,
      percentage: d.percentage,
      fill: COLORS[i % COLORS.length],
      category_id: d.category_id,
    }))
  }

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-shrink-0" style={{ width: 220, height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              activeIndex={activeIndex}
              activeShape={renderActiveShape}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(undefined)}
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [formatCents(value, currency), name]}
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f1f5f9',
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="flex-1 space-y-1.5 min-w-0 py-2">
        {chartData.map((entry, index) => (
          <div
            key={index}
            className={`flex items-start gap-2 px-2 py-1.5 rounded-lg cursor-default transition-colors ${
              activeIndex === index ? 'bg-gray-100 dark:bg-slate-800' : ''
            }`}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(undefined)}
          >
            <div
              className="flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1"
              style={{ backgroundColor: entry.fill }}
            />
            <span className="text-sm text-gray-700 dark:text-slate-300 flex-1 break-words leading-tight">
              {entry.name}
            </span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-shrink-0">
              {formatCents(entry.value, currency)}
            </span>
            <span className="text-sm text-gray-500 dark:text-slate-400 flex-shrink-0 w-9 text-right">
              {entry.percentage.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
