import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { fmtInt } from '@/lib/format'
import { toneBg, toneText, type Tone } from '@/lib/tone'

/* Sparkline: one series, no axes. Color comes from the tone via currentColor. */
export function Sparkline({
  data,
  tone = 'accent',
  width = 120,
  height = 32,
  fill = false,
  strokeWidth = 2,
  label,
  className,
}: {
  data: number[]
  tone?: Tone
  width?: number
  height?: number
  fill?: boolean
  strokeWidth?: number
  label?: string
  className?: string
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = strokeWidth
  const points = data.map((v, i) => [(i / (data.length - 1)) * width, height - pad - ((v - min) / range) * (height - pad * 2)])
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return (
    <svg
      data-slot="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0 overflow-visible', toneText[tone], className)}
    >
      {fill && <path d={`${d} L${width} ${height} L0 ${height} Z`} fill="currentColor" opacity={0.12} />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export interface BarListItem {
  key: string
  label: ReactNode
  value: number
  tone?: Tone
  hint?: ReactNode
}

/* Horizontal bars with the value at the end, for ranked breakdowns. */
export function BarList({ items, format = fmtInt, tone = 'accent', max, className }: { items: BarListItem[]; format?: (n: number) => string; tone?: Tone; max?: number; className?: string }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul data-slot="bar-list" className={cn('flex flex-col gap-12', className)}>
      {items.map((item) => (
        <li key={item.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-12 text-label">
            <span className="min-w-0 truncate text-ink">{item.label}</span>
            <span className="tabular shrink-0 text-muted">{format(item.value)}</span>
          </div>
          <div className="mt-6 h-6 overflow-hidden rounded-full bg-raised">
            <div
              className={cn('h-full w-full origin-left rounded-full transition-transform duration-200 ease-standard motion-reduce:transition-none', toneBg[item.tone ?? tone])}
              style={{ transform: `scaleX(${Math.min(1, item.value / top)})` }}
            />
          </div>
          {item.hint && <div className="mt-4 text-micro text-subtle">{item.hint}</div>}
        </li>
      ))}
    </ul>
  )
}
