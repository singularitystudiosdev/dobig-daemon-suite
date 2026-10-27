import { useState } from 'react'
import { cn } from '@/lib/cn'
import { fmtInt, fmtPct } from '@/lib/format'
import { Sparkline } from '@/components/ui'
import type { Dataset, FunnelStep } from '../data'

const ranges = [
  { id: 'weekly', label: 'Weekly', caption: 'Oct 13 to Oct 19, the last week Roblox has fully decided' },
  { id: 'monthly', label: 'Monthly', caption: 'October 2026 to date' },
] as const

const barTone: Record<FunnelStep['key'], string> = { detected: 'bg-warn', evidenced: 'bg-accent-ink', filed: 'bg-accent', removed: 'bg-live' }

export function FunnelTab({ data }: { data: Dataset }) {
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly')
  const steps = data.funnel[range]
  const max = steps[0].value
  const caption = ranges.find((r) => r.id === range)?.caption
  return (
    <div className="grid gap-24 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-12">
          <p className="text-label text-muted">{caption}</p>
          <div role="group" aria-label="Funnel range" className="flex rounded-8 border border-line bg-raised p-2">
            {ranges.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
                className={cn('state-layer h-32 rounded-8 px-12 text-label transition-colors duration-150', range === r.id ? 'bg-accent-soft text-accent-ink' : 'text-muted')}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <ol aria-label={`Takedown funnel, ${range}`} className="mt-16 flex flex-col gap-12">
          {steps.map((s, i) => (
            <li key={s.key} className="grid grid-cols-4 items-center gap-12">
              <span className="text-label text-ink">{s.label}</span>
              <span className="col-span-2 h-24 overflow-hidden rounded-8 bg-sunken">
                <span className={cn('block h-full rounded-8', barTone[s.key])} style={{ width: `${(s.value / max) * 100}%` }} />
              </span>
              <span className="tabular text-right text-label">
                <span className="font-bold text-ink">{fmtInt(s.value)}</span>
                {i > 0 && <span className="ml-8 text-muted">{fmtPct(s.value / steps[i - 1].value, 0)} of {steps[i - 1].label.toLowerCase()}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-16 max-w-prose text-micro text-subtle">
          Detected counts exact and perceptual matches. Evidenced and filed include only exact matches plus lookalikes a reviewer approved. Removed is the count Roblox reports as
          approved in Rights Manager. This week's {data.requestA} and {data.requestR} are still Pending, so they are not in the weekly view.
        </p>
      </div>
      <div className="min-w-0 rounded-8 bg-raised p-16">
        <h3 className="text-label font-medium text-ink">Links removed per week</h3>
        <p className="mt-4 text-micro text-muted">Aug 10 to Oct 19. The spike is the Oct 5 sweep, split into -A and -B at the 250-link cap.</p>
        <Sparkline data={data.funnel.weeklyRemoved} tone="live" width={280} height={72} fill label={`Links removed per week, last 11 weeks: ${data.funnel.weeklyRemoved.join(', ')}`} className="mt-16 w-full" />
        <p className="tabular mt-8 font-mono text-micro text-muted">{data.funnel.weeklyRemoved.join(', ')}</p>
      </div>
    </div>
  )
}
