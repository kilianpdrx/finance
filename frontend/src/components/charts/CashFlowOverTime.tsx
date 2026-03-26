import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { CashFlowMonth } from '../../types'

interface Props {
  data: CashFlowMonth[]
}

function centsToEur(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-')
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
  return `${months[parseInt(m) - 1]} ${year}`
}

export default function CashFlowOverTime({ data }: Props) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-sm">Aucune donnée</div>
  }

  const chartData = data.map((d) => ({
    month: formatMonth(d.month),
    Revenus: d.income_cents / 100,
    Dépenses: d.expenses_cents / 100,
    Net: d.net_cents / 100,
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <YAxis tickFormatter={(v) => `${v.toLocaleString('fr-FR')} €`} tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <Tooltip
          formatter={(value: number, name: string) => [centsToEur(value * 100), name]}
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f1f5f9',
          }}
        />
        <Legend formatter={(v) => <span style={{ color: '#cbd5e1', fontSize: 13 }}>{v}</span>} />
        <ReferenceLine y={0} stroke="#64748b" />
        <Bar dataKey="Revenus" fill="#22c55e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Dépenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
