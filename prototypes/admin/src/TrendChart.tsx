import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount, type getSeries } from './data';

export type TrendChartProps = { series: ReturnType<typeof getSeries> };

export default function TrendChart({ series }: TrendChartProps) {
  return <div className="chart-wrap" role="img" aria-label={`일별 추이, 합계 ${formatCount(series.reduce((sum, day) => sum + day.count, 0))}건`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 12, right: 20, bottom: 8, left: 2 }} accessibilityLayer>
        <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 16, fill: '#64748B' }} tickMargin={14} minTickGap={22} axisLine={{ stroke: '#B8C3D4' }} tickLine={false} />
        <YAxis width={58} tick={{ fontSize: 16, fill: '#64748B' }} tickFormatter={formatCount} tickLine={false} axisLine={{ stroke: '#B8C3D4' }} domain={[0, 'auto']} tickCount={4} />
        <Tooltip formatter={value => [formatCount(Number(value)), '건수']} labelFormatter={label => `${label}`} contentStyle={{ borderRadius: 6, borderColor: '#E2E8F0', fontSize: 16 }} />
        <Area type="linear" dataKey="count" stroke="#155EEF" strokeWidth={2} fill="#E6F4FF" fillOpacity={0.85} dot={series.length <= 7 ? { r: 5, fill: '#155EEF', stroke: '#FFFFFF', strokeWidth: 2 } : false} activeDot={{ r: 6 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
