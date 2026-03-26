import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  data: Record<string, unknown>[]
}

function formatMonth(month: string): string {
  const [year, m] = (month as string).split('-')
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
  return `${months[parseInt(m) - 1]} ${year}`
}

export default function NetWorthEvolution({ data }: Props) {
  if (!data.length) {
    return <div className="flex items-center justify-center h-64 text-gray-400 dark:text-slate-500 text-sm">Aucune donnée</div>
  }

  const chartData = data.map((d) => ({
    ...d,
    month: formatMonth(d.month as string),
    total: Math.round((d.total as number) / 100),
  }))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <defs>
          <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <YAxis
          tickFormatter={(v) => `${v.toLocaleString('fr-FR')} €`}
          tick={{ fill: '#94a3b8', fontSize: 12 }}
        />
        <Tooltip
          formatter={(value: number) => [`${value.toLocaleString('fr-FR')} €`, 'Patrimoine net']}
          contentStyle={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            color: '#f1f5f9',
          }}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#netWorthGradient)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
