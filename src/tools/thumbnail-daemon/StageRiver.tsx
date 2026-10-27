/* The signature visualization: the impression river on the left and the four 16:9 variant
   cards it feeds. Every number and every ribbon width is a pure function of sim.t. */

import { Crown, Lock, Plus, ShieldCheck, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtCompact, fmtInt, fmtPct } from '@/lib/format'
import { useReducedMotion } from '@/lib/hooks'
import { toneBg, toneFill, toneStroke, toneText } from '@/lib/tone'
import type { Simulation } from '@/lib/useSimulation'
import { Badge, Sparkline } from '@/components/ui'
import {
  LINT_BAND,
  MAX_ACTIVE_THUMBNAILS,
  SEGMENTS,
  SHARE_FLOOR,
  apiPaths,
  leaderAt,
  liveImpressionsAt,
  moderationAt,
  moderationTone,
  servedAt,
  shareAt,
  statusTone,
  variantTone,
  winnerOf,
  type ThumbDataset,
  type ThumbVariant,
} from './data'

const W = 1000
const H = 260
const HOME_X = 16
const HOME_W = 128
const HOME_Y = 128
const PORT_Y = 234
const PORT_X = [126, 359, 591, 823]

const thickness = (share: number) => 4 + share * 58

function ribbonPath(x0: number, y0: number, x1: number, y1: number, half: number) {
  const steps = 18
  const top: string[] = []
  const bottom: string[] = []
  for (let k = 0; k <= steps; k++) {
    const u = k / steps
    const ease = u * u * (3 - 2 * u)
    const x = x0 + (x1 - x0) * u
    const y = y0 + (y1 - y0) * ease
    top.push(`${x.toFixed(1)},${(y - half).toFixed(1)}`)
    bottom.push(`${x.toFixed(1)},${(y + half).toFixed(1)}`)
  }
  bottom.reverse()
  return `M${top.join(' L')} L${bottom.join(' L')} Z`
}

function particleAt(x0: number, y0: number, x1: number, y1: number, u: number) {
  const ease = u * u * (3 - 2 * u)
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * ease }
}

export function ImpressionRiver({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  const reduced = useReducedMotion()
  const variants = dataset.variants
  const shares = variants.map((v) => (moderationAt(sim, v) === 'Rejected' ? 0 : shareAt(sim, v)))
  const live = variants.map((v) => liveImpressionsAt(sim, v))
  const widths = shares.map((s) => (s > 0 ? thickness(s) : 0))
  const total = widths.reduce((a, b) => a + b, 0)
  const served = servedAt(sim, variants)

  let cursor = HOME_Y - total / 2
  const slots = widths.map((w) => {
    const mid = cursor + w / 2
    cursor += w
    return mid
  })

  const phase = reduced ? 0 : (sim.t / 2600) % 1
  const xx = HOME_X + HOME_W
  const active = sim.reached('explore')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Impression river: Home sends ${variants
        .map((v) => `${fmtPct(shares[variants.indexOf(v)], 0)} to ${v.id}`)
        .join(', ')}. ${fmtCompact(served)} impressions served.`}
      className="h-260 w-full"
    >
      <defs>
        <clipPath id="river-clip">
          <rect x={HOME_X} y={0} width={W - HOME_X} height={H} />
        </clipPath>
      </defs>

      <g clipPath="url(#river-clip)">
        {variants.map((v, i) => {
          const w = widths[i]
          if (w <= 0) return null
          const half = w / 2
          const y0 = slots[i]
          const y1 = PORT_Y
          const d = ribbonPath(xx, y0, PORT_X[i], y1, half)
          const count = Math.max(1, Math.round(shares[i] * 9))
          return (
            <g key={v.id}>
              <path d={d} className={cn(toneFill[variantTone[v.id]], active ? 'opacity-35' : 'opacity-15')} />
              <path
                d={`M${xx},${y0} C${xx + 120},${y0} ${PORT_X[i] - 80},${y1} ${PORT_X[i]},${y1}`}
                fill="none"
                strokeWidth={1}
                className={cn(toneStroke[variantTone[v.id]], 'opacity-50')}
              />
              {Array.from({ length: count }, (_, k) => {
                const u = (phase + k / count) % 1
                const p = particleAt(xx, y0, PORT_X[i], y1, u)
                return (
                  <circle
                    key={k}
                    cx={p.x}
                    cy={p.y}
                    r={Math.max(1.4, Math.min(3.2, half * 0.3))}
                    className={cn(toneFill[variantTone[v.id]], 'opacity-90')}
                  />
                )
              })}
            </g>
          )
        })}
      </g>

      <rect
        x={HOME_X}
        y={HOME_Y - Math.max(total, 34) / 2 - 12}
        width={HOME_W}
        height={Math.max(total, 34) + 24}
        rx={8}
        className="fill-raised stroke-line"
        strokeWidth={1}
      />
      <text x={HOME_X + 12} y={HOME_Y - 8} className="fill-ink text-label font-bold">
        Home
      </text>
      <text x={HOME_X + 12} y={HOME_Y + 10} className="fill-ink font-mono text-micro tabular">
        {fmtCompact(served)}
      </text>
      <text x={HOME_X + 12} y={HOME_Y + 24} className="fill-subtle text-micro">
        impressions
      </text>

      {variants.map((v, i) => (
        <g key={`port-${v.id}`}>
          <rect x={PORT_X[i] - 44} y={PORT_Y - 13} width={88} height={26} rx={8} className="fill-surface stroke-line" strokeWidth={1} />
          <text x={PORT_X[i]} y={PORT_Y + 4} textAnchor="middle" className="font-mono text-micro">
            <tspan className="fill-ink">{v.id}</tspan>
            <tspan className="fill-muted"> {!active ? 'queued' : shares[i] === 0 ? 'no traffic' : fmtPct(shares[i], 0)}</tspan>
          </text>
        </g>
      ))}
      <text x={PORT_X[0] - 60} y={PORT_Y + 44} className="fill-subtle text-micro">
        {fmtInt(live[0])} impressions to T1
      </text>
    </svg>
  )
}

export function SegmentSplit({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  const progress = sim.within('segment')
  const currentRow = sim.reached('segment') ? Math.min(SEGMENTS.length - 1, Math.floor(progress * SEGMENTS.length)) : -1
  return (
    <div className="flex h-260 flex-col justify-center gap-8">
      <p className="text-micro text-muted">Modelled traffic split per segment, winner crowned row by row</p>
      <ol className="flex flex-col gap-8" aria-label="Segment traffic split, modelled">
      {SEGMENTS.map((segment, i) => {
        const rows = dataset.cells.filter((c) => c.segment === segment)
        const winner = winnerOf(dataset.cells, segment)
        const max = Math.max(...rows.map((c) => c.qptr), 0.0001)
        const weights = rows.map((c) => (c.qptr === 0 ? 0 : Math.pow(c.qptr / max, 8)))
        const weightTotal = weights.reduce((a, b) => a + b, 0) || 1
        const crowned = currentRow >= i
        const evaluating = currentRow === i
        return (
          <li
            key={segment}
            className={cn('flex items-center gap-12 rounded-8 px-8 py-8', evaluating && 'bg-raised')}
          >
            <span className="w-96 shrink-0 text-micro text-muted">{segment}</span>
            <span className="flex min-w-0 flex-1 items-center gap-4">
              {rows.map((c, k) => (
                <span
                  key={c.variantId}
                  className={cn('h-20 rounded-full', c.qptr === 0 ? 'bg-raised' : toneBg[variantTone[c.variantId]])}
                  style={{ width: `${Math.max(3, (weights[k] / weightTotal) * 100)}%` }}
                >
                  <span className="sr-only">
                    {c.variantId} {c.qptr === 0 ? 'rejected' : fmtPct(c.qptr, 1)}
                  </span>
                </span>
              ))}
            </span>
            <span className="flex w-112 shrink-0 items-center justify-end gap-4">
              {crowned ? (
                <>
                  <Crown aria-hidden className="size-12 text-warn" />
                  <span className="font-mono text-micro text-ink">{winner.variantId}</span>
                  <span className="tabular font-mono text-micro text-muted">{fmtPct(winner.qptr, 1)}</span>
                </>
              ) : (
                <span className="text-micro text-subtle">waiting</span>
              )}
            </span>
          </li>
        )
        })}
      </ol>
    </div>
  )
}

function CreativeCard({ sim, dataset, variant }: { sim: Simulation; dataset: ThumbDataset; variant: ThumbVariant }) {
  const meta = dataset.meta[variant.id]
  const moderation = moderationAt(sim, variant)
  const rejected = moderation === 'Rejected'
  const share = shareAt(sim, variant)
  const served = liveImpressionsAt(sim, variant)
  const series = dataset.series.find((_, i) => dataset.variants[i]?.id === variant.id) ?? []
  const trend = series.map((p) => p.qptr).filter((n) => n > 0)
  const linted = sim.reached('lint')
  const tone = variantTone[variant.id]

  return (
    <article className="flex min-w-0 flex-col gap-8 rounded-8 border border-line bg-raised p-8">
      <div className="relative aspect-video overflow-hidden rounded-8 bg-sunken">
        <img
          src={dataset.game.thumb}
          alt={`${variant.label}, thumbnail variant ${variant.id}`}
          width={640}
          height={360}
          className={cn('size-full object-cover', rejected && 'opacity-40 grayscale')}
          style={{ transform: `scale(${meta.creative.scale})`, objectPosition: meta.creative.position }}
        />
        <span aria-hidden className={cn('absolute inset-0', meta.creative.tint)} />
        <span className="absolute left-8 top-8 rounded-full bg-canvas px-8 py-2 text-micro text-ink">{meta.creative.overlay}</span>
        {linted && <span aria-hidden className="absolute inset-x-0 bottom-0 border-t border-danger bg-danger opacity-25" style={{ height: `${LINT_BAND * 100}%` }} />}
        {linted && variant.id === 'T1' && (
          <span className="absolute inset-x-8 bottom-8 flex items-center gap-4 text-micro text-ink">
            <TriangleAlert aria-hidden className="size-12 shrink-0" />
            logo covered
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-8">
        <span className={cn('shrink-0 font-mono text-micro', toneText[tone])}>{variant.id}</span>
        <span className="min-w-0 flex-1 truncate text-label font-medium text-ink">{variant.label}</span>
        <span className="tabular shrink-0 font-mono text-label font-bold text-ink">
          {!sim.reached('explore') ? 'queued' : rejected ? '0%' : fmtPct(share, 0)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-8">
        <Badge tone={rejected ? 'danger' : moderation === 'Pending' ? 'warn' : statusTone[variant.status]}>
          {rejected ? 'Rejected' : moderation === 'Pending' ? 'Pending' : variant.status}
        </Badge>
        {sim.reached('exploit') && !rejected ? (
          <span className="flex items-center gap-6">
            <Sparkline data={trend.length > 1 ? trend : [variant.qptr, variant.qptr]} tone={tone} width={56} height={16} label={`QPTR trend for ${variant.id}`} />
            <span className="tabular font-mono text-micro text-muted">{fmtPct(variant.qptr, 1)}</span>
          </span>
        ) : (
          <span className="text-micro text-subtle">{rejected ? 'moderation rejected' : sim.reached('explore') ? 'learning' : 'awaiting upload'}</span>
        )}
      </div>

      <p className="text-micro text-muted">
        {rejected ? `0 impressions, ${meta.moderationReason ?? 'moderation rejected'}` : `${fmtCompact(served)} impressions this run`}
      </p>
      {linted && !rejected && (
        <p className={cn('text-micro', meta.lint.ok ? 'text-subtle' : 'text-danger')}>{meta.lint.label}</p>
      )}
    </article>
  )
}

export function StageRiver({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  const mobile = winnerOf(dataset.cells, '9-12 Mobile')
  const desktop = winnerOf(dataset.cells, '13-17 Desktop')
  const leader = leaderAt(sim, dataset.variants)
  const segmentStage = sim.reached('segment')
  const p = apiPaths(dataset.universeId)
  return (
    <div className="flex flex-col gap-16">
      {segmentStage ? <SegmentSplit sim={sim} dataset={dataset} /> : <ImpressionRiver sim={sim} dataset={dataset} />}

      <p className="max-w-prose text-label text-muted">
        {segmentStage
          ? `The winner depends on the segment, not on one global winner: ${mobile.variantId} leads 9-12 Mobile at ${fmtPct(mobile.qptr, 1)} QPTR while ${desktop.variantId} leads the other three.`
          : sim.reached('exploit')
            ? `Impressions shift toward ${leader.label} as the bandit learns, and every arm keeps a ${fmtPct(SHARE_FLOOR, 0)} floor so no creative goes dark.`
            : `Impressions split evenly across four creatives while the bandit learns, with a ${fmtPct(SHARE_FLOOR, 0)} floor held back so no creative goes dark.`}
      </p>

      <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 xl:grid-cols-4">
        {dataset.variants.map((v) => (
          <CreativeCard key={v.id} sim={sim} dataset={dataset} variant={v} />
        ))}
      </div>

      {sim.reached('apply') && (
        <div className="rounded-8 border border-line bg-sunken px-12 py-12">
          <div className="flex flex-wrap items-center gap-8">
            <code className="break-all font-mono text-micro text-live">{p.update}</code>
            <Badge tone="live">200 OK</Badge>
            <Badge tone="accent">Config Active</Badge>
          </div>
          <p className="mt-4 text-micro text-muted">Update keeps the impression stats. Create resets them, so this run posts an update.</p>
          <div className="mt-8 flex flex-wrap items-center gap-8">
            <button
              type="button"
              disabled
              aria-describedby="create-note"
              className="rounded-8 border border-line px-8 py-4 font-mono text-micro text-subtle line-through"
            >
              {p.create}
            </button>
            <span id="create-note" className="text-micro text-muted">
              would reset stats
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/* The five active slots plus the disabled sixth, kept visible under the stage. */
export function UploadSlots({ sim, dataset }: { sim: Simulation; dataset: ThumbDataset }) {
  const active = dataset.variants.filter((v) => moderationAt(sim, v) !== 'Rejected').length
  return (
    <section aria-label="Thumbnail slots" className="rounded-20 border border-line bg-surface p-16">
      <div className="flex flex-wrap items-baseline justify-between gap-8">
        <h2 className="text-label font-medium text-ink">Thumbnail slots</h2>
        <span className="text-micro text-muted">
          {active} active of {MAX_ACTIVE_THUMBNAILS} allowed, Roblox keeps 2 to 5 per universe
        </span>
      </div>
      <ol className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3 lg:grid-cols-6">
        {dataset.variants.map((v) => {
          const moderation = moderationAt(sim, v)
          return (
            <li key={v.id} className="flex min-w-0 flex-col gap-4 rounded-8 border border-line bg-raised px-8 py-8">
              <span className="flex items-center justify-between gap-8">
                <span className="font-mono text-micro text-muted">{v.id}</span>
                <Badge tone={moderationTone[moderation]}>{moderation}</Badge>
              </span>
              <span className="truncate text-label text-ink">{v.label}</span>
              <span className="font-mono text-micro text-subtle">{fmtInt(v.assetId)}</span>
            </li>
          )
        })}
        <li className="flex min-w-0 flex-col gap-4 rounded-8 border border-dashed border-line-strong px-8 py-8">
          <span className="flex items-center justify-between gap-8">
            <span className="font-mono text-micro text-muted">T5</span>
            <Plus aria-hidden className="size-12 text-subtle" />
          </span>
          <span className="text-label text-muted">Open slot</span>
          <span className="text-micro text-subtle">No upload this run</span>
        </li>
        <li className="flex min-w-0 flex-col gap-4 rounded-8 border border-line px-8 py-8">
          <button type="button" disabled aria-describedby="slot-6-note" className="flex items-center justify-between gap-8 text-left">
            <span className="font-mono text-micro text-subtle">T6</span>
            <Lock aria-hidden className="size-12 text-subtle" />
          </button>
          <span className="text-label text-subtle">Locked slot</span>
          <span id="slot-6-note" className="text-micro text-subtle">
            Roblox allows 2 to 5 active thumbnails, so a sixth cannot upload
          </span>
        </li>
      </ol>
      <p className="mt-8 flex items-center gap-6 text-micro text-subtle">
        <ShieldCheck aria-hidden className="size-12" />
        1920x1080, 16:9, under 3 MB, essential content above the bottom 14% overlay band
      </p>
    </section>
  )
}
