import type { ReactNode } from 'react'
import { Radar } from 'lucide-react'
import type { Tone } from '@/lib/tone'
import type { Simulation } from '@/lib/useSimulation'
import { EmptyState, SkeletonRows } from '@/components/ui'
import type { ApiCall, ExploitCluster, PatchStatus, Severity, Verdict } from './data'

export const sevTone: Record<Severity, Tone> = { CRIT: 'danger', HIGH: 'danger', MED: 'warn', LOW: 'muted' }
export const statusTone: Record<PatchStatus, Tone> = { open: 'warn', monitoring: 'data5', patched: 'live' }
export const confTone: Record<ExploitCluster['confidence'], Tone> = { confirmed: 'ink', likely: 'muted', unverified: 'warn' }
export const trendTone: Record<ExploitCluster['trend'], Tone> = { rising: 'danger', flat: 'muted', fading: 'live' }
export const verdictTone: Record<Verdict, Tone> = { real: 'live', 'key-system bait': 'warn', malware: 'danger', fake: 'data6', 're-upload': 'muted' }

/** Script time the page should render: the end state once done, nothing before start. */
export function viewT(sim: Simulation) {
  if (sim.status === 'done') return Infinity
  if (sim.status === 'idle') return -1
  return sim.t
}

export function quotaAt(calls: ApiCall[], t: number) {
  let search = 0
  let units = 0
  for (const c of calls) {
    if (c.at > t) continue
    if (c.method === 'search.list') search += c.cost
    else units += c.cost
  }
  return { search, units }
}

/* Results gate: idle shows the one-action empty state, a running stage that has not produced the
   tab's data yet shows skeleton rows, then the content. */
export function Gate({ sim, ready, sentence, rows = 5, children }: { sim: Simulation; ready: boolean; sentence: string; rows?: number; children: ReactNode }) {
  if (sim.status === 'idle') return <EmptyState icon={Radar} sentence={sentence} actionLabel="Run daemon" onAction={sim.start} />
  if (!ready) return <SkeletonRows rows={rows} />
  return <>{children}</>
}

export const LINK_WITHHELD = '[link withheld]'

export function Withheld() {
  return (
    <span className="font-mono text-micro text-subtle" title="Links to exploit sellers and downloads are never shown">
      {LINK_WITHHELD}
    </span>
  )
}
