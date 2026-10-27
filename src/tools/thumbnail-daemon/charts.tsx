/* Local line chart for the two result graphs. The shared Sparkline covers the per-card QPTR
   trend. Every series here is simulated, and the tab labels it that way. */

import { cn } from '@/lib/cn'
import { toneBg, toneStroke, type Tone } from '@/lib/tone'

export interface ChartSeries {
  id: string
  label: string
  tone: Tone
  values: number[]
  muted?: boolean
}

const W = 1080
const H = 260
const PAD_L = 64
const PAD_R = 16
const PAD_T = 18
const PAD_B = 30

export function MultiLineChart({
  series,
  format,
  ariaLabel,
  maxValue,
  className,
}: {
  series: ChartSeries[]
  format: (n: number) => string
  ariaLabel: string
  maxValue?: number
  className?: string
}) {
  const days = Math.max(...series.map((s) => s.values.length), 2)
  const top = Math.max(maxValue ?? 0, ...series.flatMap((s) => s.values), 0.0001)
  const xOf = (i: number) => PAD_L + (i / (days - 1)) * (W - PAD_L - PAD_R)
  const yOf = (v: number) => PAD_T + (1 - v / top) * (H - PAD_T - PAD_B)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className={cn('h-260 w-full', className)}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD_L} x2={W - PAD_R} y1={yOf(top * f)} y2={yOf(top * f)} className="stroke-line" strokeWidth={1} aria-hidden />
          <text x={PAD_L - 8} y={yOf(top * f) + 4} textAnchor="end" className="fill-subtle font-mono text-micro">
            {f === 0 ? '0' : format(top * f)}
          </text>
        </g>
      ))}
      <text x={PAD_L} y={H - 6} className="fill-subtle text-micro">
        day 1
      </text>
      <text x={W - PAD_R} y={H - 6} textAnchor="end" className="fill-subtle text-micro">
        day 14
      </text>
      {series.map((s) => {
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ')
        return (
          <path
            key={s.id}
            d={d}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.muted ? '4 4' : undefined}
            className={cn(toneStroke[s.tone], s.muted && 'opacity-60')}
          />
        )
      })}
    </svg>
  )
}

export function ChartLegend({ series, format }: { series: ChartSeries[]; format: (n: number) => string }) {
  return (
    <ul className="mt-12 flex flex-wrap gap-x-16 gap-y-8">
      {series.map((s) => (
        <li key={s.id} className="flex items-center gap-8 text-micro text-muted">
          <span aria-hidden className={cn('h-2 w-16 rounded-full', toneBg[s.tone], s.muted && 'opacity-60')} />
          <span className="text-ink">{s.label}</span>
          <span className="tabular font-mono text-subtle">{format(s.values[s.values.length - 1] ?? 0)}</span>
        </li>
      ))}
    </ul>
  )
}
