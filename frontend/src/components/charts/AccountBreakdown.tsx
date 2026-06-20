import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

import { currencySymbol } from '../../utils/currency'

interface Props {
  data: Record<string, unknown>[]
  currency?: string
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
  return `${months[parseInt(m) - 1]} ${year}`
}

const COLORS = ['#10b981', '#22c55e', '#f97316', '#3b82f6', '#ec4899', '#f59e0b']

export default function AccountBreakdown({ data, currency = 'EUR' }: Props) {
  const sym = currencySymbol(currency)
  if (!data.length) {
    return <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-sm">Aucune donnée</div>
  }

  const accountKeys = Object.keys(data[0] || {}).filter((k) => k !== 'month' && k !== 'total' && !k.endsWith('_native'))

  const chartData = data.map((d) => {
    const entry: Record<string, unknown> = { month: formatMonth(d.month as string) }
    for (const k of accountKeys) {
      entry[k] = Math.round((d[k] as number) / 100)
    }
    return entry
  })

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <YAxis
          tickFormatter={(v) => `${v.toLocaleString('fr-FR')} ${sym}`}
          tick={{ fill: '#94a3b8', fontSize: 12 }}
        />
        <Tooltip
          formatter={(value: number, name: string) => [`${value.toLocaleString('fr-FR')} ${sym}`, name]}
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f1f5f9',
          }}
        />
        <Legend formatter={(v) => <span style={{ color: '#cbd5e1', fontSize: 13 }}>{v}</span>} />
        {accountKeys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="a" fill={COLORS[i % COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
