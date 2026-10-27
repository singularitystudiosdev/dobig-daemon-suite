import type { Game } from '@/data/games'
import { fmtCompact, fmtDay, fmtInt } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { buildDataset, SEARCH_CAP, verdictLabel, type ExploitCluster, type HackDataset, type Severity } from '@/tools/hack-daemon/data'
import type { Chip, Finding, FindingsModel } from '../types'
import { plain, ramp } from './shared'

const SEV_ORDER: Record<Severity, number> = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 }
const SEV_TONE: Record<Severity, Tone> = { CRIT: 'danger', HIGH: 'warn', MED: 'accent', LOW: 'muted' }
const TREND_TONE: Record<ExploitCluster['trend'], Tone> = { rising: 'danger', flat: 'muted', fading: 'live' }
const STATUS: Record<string, Chip> = {
  open: { label: 'Open', tone: 'warn' },
  monitoring: { label: 'Monitoring', tone: 'accent' },
  patched: { label: 'Patched', tone: 'live' },
}

/** Clusters ordered by severity, then total views. */
export function hackFindings(ds: HackDataset): Finding[] {
  const sorted = ds.clusters.slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.totalViews - a.totalViews)
  return sorted.map((c) => {
    const brief = ds.briefs.find((b) => b.clusterId === c.id)
    const sources = ds.sources.filter((v) => v.clusterId === c.id).sort((a, b) => b.viewCount - a.viewCount)
    return {
      id: c.id,
      badge: { label: c.severity, tone: SEV_TONE[c.severity] },
      title: `${c.cls} on ${c.system}`,
      snippet: plain(brief?.observed ?? ''),
      meta: [
        { label: 'Videos', value: fmtInt(c.videos) },
        { label: 'Views', value: fmtCompact(c.totalViews) },
        { label: 'First seen', value: fmtDay(c.firstSeen) },
      ],
      spark: { data: c.daily, tone: TREND_TONE[c.trend], label: `${c.trend}, daily new views over 14 days` },
      status: STATUS[brief?.status ?? 'open'],
      states: { patched: STATUS.patched },
      detail: {
        kind: 'hack',
        system: c.system,
        side: c.side,
        cls: c.cls,
        observed: brief?.observed ?? '',
        cause: brief?.cause ?? '',
        fix: brief?.fix ?? '',
        confidence: c.confidence,
        trend: c.trend,
        firstSeen: fmtDay(c.firstSeen),
        sources: sources.slice(0, 4).map((v) => ({ title: v.title, channel: v.channel, verdict: verdictLabel[v.verdict], views: v.viewCount })),
        moreSources: Math.max(0, sources.length - 4),
      },
    }
  })
}

export function hackModel(game: Game): FindingsModel {
  const ds = buildDataset(game)
  const findings = hackFindings(ds)
  const crawled = ds.sources.length
  const struck = Object.values(ds.filteredBy).reduce((a, n) => a + n, 0)
  const real = crawled - struck
  const searchCalls = ds.calls.filter((c) => c.method === 'search.list').length
  const k = ds.clusters.length
  return {
    findings,
    sortLabel: 'Sorted by severity',
    steps: [
      () => `4 terms, 2 exclusions, published after ${new Date(ds.publishedAfter).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`,
      (p) => `${ramp(crawled, p)} videos fetched, ${Math.max(1, Math.ceil(searchCalls * p))} of ${SEARCH_CAP} search calls used`,
      (p) => `${ramp(struck, p)} of ${struck} struck as bait, malware, re-uploads or fakes`,
      (p) => `${ramp(real, p)} real videos grouped into ${Math.max(1, Math.ceil(k * p))} of ${k} clusters`,
      (p) => `${ramp(k, p)} of ${k} clusters mapped to a game system`,
      (p) => `${ramp(k, p)} of ${k} developer briefs written`,
    ],
    summary: (states) => {
      const patched = Object.values(states).filter((s) => s === 'patched').length
      return {
        items: [
          { label: 'Videos crawled', value: fmtInt(crawled) },
          { label: 'Struck as bait', value: fmtInt(struck), tone: 'warn' },
          { label: 'Real', value: fmtInt(real), tone: 'danger' },
          { label: 'Clusters', value: patched ? `${k - patched} open of ${k}` : fmtInt(k) },
        ],
      }
    },
    notices: [
      {
        lead: 'Client anti-tamper does not fix server trust: never trust the client.',
        body: 'Hyperion raises the cost of injecting code, but every fix below is server-side: validate RemoteEvent and RemoteFunction arguments, distance, cooldowns and ownership on the server. Briefs name the class of problem, never working code.',
      },
    ],
  }
}
