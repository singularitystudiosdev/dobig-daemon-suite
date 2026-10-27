import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Camera, FileCheck2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp, fmtInt } from '@/lib/format'
import type { Simulation } from '@/lib/useSimulation'
import type { Game } from '@/data/games'
import { Badge, ProgressBar } from '@/components/ui'
import { Knockoff } from './Knockoff'
import { AT, ATTESTATION, DROP_MS, FADE_MS, HOLD_MS, LINK_CAP, SHOW_GAP, SHOW_LEAD, SOURCES, TOTALS, shortHash, type Dataset, type Lane, type ShowcaseItem } from './data'

/* The two-lane sorter. Candidate cards ride a conveyor into a scan beam that compares their asset
   hashes with the registered fingerprints, then drop into Auto-file (exact sha256 only), Human
   review (perceptual), Cleared (licensed) or No match. Every position is a pure function of sim.t. */

const BELT_H = 132
const CARD_W = 112
const CARD_TOP = 20
const LANES_TOP = BELT_H + 24
const SLOT = CARD_W + 16 // px between queued cards
const MOVE_MS = 240 // the belt indexes one slot in this long, then holds for the scan
const LANE_COL: Record<Lane, number> = { 'auto-file': 0, review: 2, cleared: 3, none: 4 }

function easeInOut(p: number) {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
}

/* Indexing conveyor: slots advanced at script time t. Card i sits under the beam when this equals i. */
function beltSlots(t: number) {
  const v = (Math.max(t, AT.match) - AT.match - SHOW_LEAD) / SHOW_GAP
  const n = Math.floor(v)
  const inPeriod = (v - n) * SHOW_GAP
  const moving = inPeriod - (SHOW_GAP - MOVE_MS)
  return moving > 0 ? n + easeInOut(moving / MOVE_MS) : n
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** The showcase card at the beam right now, if any. */
export function currentItem(data: Dataset, sim: Simulation): ShowcaseItem | null {
  if (sim.status === 'idle' || sim.t < AT.match || sim.t >= AT.evidence) return null
  let cur: ShowcaseItem | null = null
  for (const s of data.showcase) if (sim.t >= s.arrive) cur = s
  if (cur && sim.t >= cur.arrive + SHOW_GAP) return null
  return cur
}

/** Lane counter at script time t: climbs through the match stage. */
export function laneCount(sim: Simulation, total: number) {
  return Math.round(total * sim.within('match'))
}

export function Sorter({ sim, data, game, reduced }: { sim: Simulation; data: Dataset; game: Game; reduced: boolean }) {
  const [ref, W] = useWidth()
  const t = sim.status === 'idle' ? 0 : sim.t
  const beamX = Math.round(W * 0.34)
  const colW = (W - 48) / 5
  const laneCenter = (lane: Lane) => (lane === 'auto-file' ? 12 + 64 : LANE_COL[lane] * (colW + 12) + colW / 2)
  const laneTargetY = (lane: Lane) => LANES_TOP + (lane === 'auto-file' ? 84 : 120)
  const cur = currentItem(data, sim)
  const matching = sim.status === 'running' && sim.stageState('match') === 'active'

  /* Card geometry on the belt and in flight. */
  const belt: { s: ShowcaseItem; x: number; o: number }[] = []
  const flying: { s: ShowcaseItem; x: number; y: number; k: number; o: number }[] = []
  if (W > 0 && sim.status !== 'idle') {
    data.showcase.forEach((s, i) => {
      const tt = Math.max(t, AT.match)
      const slots = beltSlots(t)
      const releaseAt = s.arrive + HOLD_MS
      if (reduced) {
        if (cur === s) belt.push({ s, x: beamX - CARD_W / 2, o: 1 })
        return
      }
      if (tt < releaseAt) {
        const x = beamX - CARD_W / 2 - Math.max(0, i - slots) * SLOT
        if (x < -CARD_W) return
        // During the crawl the queued cards tick in one by one.
        const o = t < AT.match ? clamp(sim.within('crawl') * 4 - i) : 1
        belt.push({ s, x, o })
        return
      }
      const p = clamp((t - releaseAt) / DROP_MS)
      const fade = clamp((t - releaseAt - DROP_MS) / FADE_MS)
      if (fade >= 1) return
      const e = easeInOut(p)
      const x0 = beamX - CARD_W / 2
      const y0 = CARD_TOP
      const x1 = laneCenter(s.c.lane) - CARD_W / 2
      const y1 = laneTargetY(s.c.lane) - 46 * 0.55
      flying.push({ s, x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e - Math.sin(Math.PI * e) * 12, k: 1 - 0.5 * e, o: 1 - fade })
    })
  }

  return (
    <div ref={ref} className="relative" data-slot="dmca-sorter">
      {/* Conveyor */}
      <div className="relative h-132 overflow-hidden rounded-8 border border-line bg-sunken">
        <span aria-hidden className="absolute inset-x-0 bottom-12 border-t border-dashed border-line-strong" />
        {belt.map(({ s, x, o }) => (
          <BeltCard key={s.c.id} s={s} game={game} style={{ transform: `translate(${x}px, ${CARD_TOP}px)`, opacity: o }} lit={cur === s} />
        ))}
        {/* Scan beam */}
        <div aria-hidden className="absolute inset-y-0 w-2 overflow-hidden bg-accent-soft" style={{ transform: `translateX(${beamX - 1}px)` }}>
          <span className={cn('block h-full w-full', matching ? 'bg-accent motion-safe:animate-scan' : 'bg-line-strong')} />
        </div>
        <Readout sim={sim} data={data} cur={cur} left={sim.status !== 'idle' && t >= AT.evidence ? beamX + 24 : beamX + CARD_W / 2 + 16} />
      </div>

      {/* Lanes */}
      <div className="mt-24 grid grid-cols-5 gap-12">
        <AutoLane sim={sim} data={data} game={game} />
        <ReviewLane sim={sim} data={data} game={game} />
        <ClearedLane sim={sim} data={data} game={game} />
        <NoneLane sim={sim} />
      </div>

      {/* Cards in flight, above both */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {flying.map(({ s, x, y, k, o }) => (
          <BeltCard key={s.c.id} s={s} game={game} style={{ transform: `translate(${x}px, ${y}px) scale(${k})`, opacity: o }} lit />
        ))}
      </div>
    </div>
  )
}

const laneTone = { 'auto-file': 'border-live bg-live-soft', review: 'border-warn bg-warn-soft', cleared: 'border-line-strong bg-raised', none: 'border-line bg-surface' } as const

function BeltCard({ s, game, style, lit }: { s: ShowcaseItem; game: Game; style: CSSProperties; lit?: boolean }) {
  return (
    <div
      className={cn('absolute left-0 top-0 flex w-112 origin-top-left flex-col gap-4 rounded-8 border p-8', lit ? laneTone[s.c.lane] : 'border-line bg-raised')}
      style={style}
    >
      <Knockoff game={game} variant={s.c.thumbVariant} size={40} />
      <span className="truncate text-micro font-medium text-ink">{s.c.name}</span>
      <span className="tabular truncate font-mono text-micro text-muted">{s.c.placeId}</span>
    </div>
  )
}

function Readout({ sim, data, cur, left }: { sim: Simulation; data: Dataset; cur: ShowcaseItem | null; left: number }) {
  const t = sim.t
  let body: ReactNode
  if (sim.status === 'idle' || t < AT.crawl) {
    body = (
      <p className="text-label text-muted">
        Hashing {data.assets.length} registered assets. Candidates wait until every fingerprint is stored.
      </p>
    )
  } else if (t < AT.match) {
    const p = sim.within('crawl')
    return (
      <ReadoutFrame left={left}>
        <p className="text-label text-muted">Crawling search and similar-games lists</p>
        <p className="tabular mt-4 text-title font-bold text-ink">
          {fmtInt(TOTALS.crawled * p)} <span className="text-label font-normal text-muted">of {TOTALS.crawled} candidates</span>
        </p>
        <p className="tabular mt-4 font-mono text-micro text-subtle">
          search {Math.round(SOURCES.search * p)}, similar {Math.round(SOURCES.similar * p)}, recommended {Math.round(SOURCES.recommended * p)}
        </p>
      </ReadoutFrame>
    )
  } else if (cur) {
    const c = cur.c
    const a = cur.asset
    if (c.lane === 'auto-file' && a) {
      body = (
        <div key={c.id} className="motion-safe:animate-enter">
          <p className="flex flex-wrap items-baseline gap-8 font-mono text-stat text-live">
            <span className="text-label text-muted">sha256</span>
            <span>{shortHash(a.sha256)}</span>
            <span className="text-muted">=</span>
            <span>{shortHash(a.sha256)}</span>
          </p>
          <p className="mt-4 text-micro text-muted">
            place <span className="font-mono">{c.placeId}</span> carries {a.name} ({a.assetId}) byte for byte
          </p>
          <Badge tone="live" className="mt-8">
            Exact match, auto-file
          </Badge>
        </div>
      )
    } else if (c.lane === 'review') {
      body = (
        <div key={c.id} className="motion-safe:animate-enter">
          <p className="flex items-baseline gap-8 font-mono text-stat text-warn">
            {c.kind} {c.similarity?.toFixed(2)}
            <span className="font-sans text-label text-muted">vs {a?.name}</span>
          </p>
          <p className="mt-4 text-micro text-muted">Similar, not identical. Perceptual matches never enter the auto-file lane.</p>
          <Badge tone="warn" className="mt-8">
            Perceptual, human review
          </Badge>
        </div>
      )
    } else if (c.lane === 'cleared') {
      body = (
        <div key={c.id} className="motion-safe:animate-enter">
          <p className="font-mono text-stat text-muted">licensed</p>
          <p className="mt-4 truncate text-micro text-muted">{c.licenseNote}</p>
          <Badge tone="muted" className="mt-8">
            Creator Store, cleared
          </Badge>
        </div>
      )
    } else {
      body = (
        <div key={c.id} className="motion-safe:animate-enter">
          <p className="font-mono text-stat text-subtle">no match</p>
          <p className="mt-4 text-micro text-subtle">No fingerprint within threshold for {c.name}. Nothing is filed.</p>
        </div>
      )
    }
  } else if (t >= AT.match && t < AT.evidence) {
    body = <p className="text-label text-muted">Comparing the next batch</p>
  } else {
    body = (
      <div>
        <p className="tabular text-label text-ink">
          {TOTALS.crawled} compared: <span className="text-live">{TOTALS.auto} exact</span>, <span className="text-warn">{TOTALS.review} perceptual</span>, {TOTALS.cleared} licensed,{' '}
          <span className="text-subtle">{TOTALS.none} no match</span>
        </p>
        <p className="mt-4 text-micro text-muted">Only the {TOTALS.auto} exact matches ride the standing attestation.</p>
      </div>
    )
  }
  return <ReadoutFrame left={left}>{body}</ReadoutFrame>
}

function ReadoutFrame({ left, children }: { left: number; children: ReactNode }) {
  return (
    <div className="absolute inset-y-0 right-16 flex min-w-0 flex-col justify-center" style={{ left }}>
      {children}
    </div>
  )
}

/* Lane counts, shared with the aside. */
export function laneCounts(sim: Simulation) {
  return {
    auto: laneCount(sim, TOTALS.auto),
    review: laneCount(sim, TOTALS.review),
    cleared: laneCount(sim, TOTALS.cleared),
    none: laneCount(sim, TOTALS.none),
  }
}

function LaneHead({ label, count, tone }: { label: string; count: number; tone: 'live' | 'warn' | 'muted' | 'ink' }) {
  return (
    <div className="flex items-center justify-between gap-8">
      <Badge tone={tone} dot={tone !== 'ink'} pulse={false}>
        {label}
      </Badge>
      <span className="tabular text-stat font-bold text-ink">{count}</span>
    </div>
  )
}

function AutoLane({ sim, data, game }: { sim: Simulation; data: Dataset; game: Game }) {
  const n = laneCount(sim, TOTALS.auto)
  const fileP = sim.within('file')
  const seal = easeInOut(clamp((fileP - 0.62) / 0.16))
  const sealed = fileP >= 0.78
  const pending = fileP >= 0.85
  const evP = sim.within('evidence')
  const evidenced = Math.round(TOTALS.auto * evP)
  const rows = data.showcase.filter((s) => s.c.lane === 'auto-file' && sim.t >= s.arrive + HOLD_MS + DROP_MS)
  return (
    <div className="col-span-2 flex min-w-0 flex-col gap-8 rounded-8 border border-line p-12">
      <LaneHead label="Auto-file" count={n} tone="live" />
      <div className="flex gap-12">
        <div className="relative w-128 shrink-0">
          <Envelope seal={seal} filled={n > 0} />
          {sealed && (
            <span className="absolute left-1/2 top-40 -translate-x-1/2 rounded-8 border border-live bg-canvas px-6 py-2 text-micro font-bold text-live motion-safe:animate-stamp">
              Sealed
            </span>
          )}
          <p className="tabular mt-4 text-center text-label text-ink">
            <span className="font-bold">{n}</span> <span className="text-muted">of {LINK_CAP} links</span>
          </p>
          <ProgressBar value={n / LINK_CAP} tone="live" size="sm" label="Links in this request out of the 250 cap" className="mt-4" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <p className="text-micro text-muted">Exact sha256 matches only</p>
          {rows.map((s, i) => {
            const shot = evP >= (i + 1) * 0.12
            const record = evP >= (i + 1) * 0.12 + 0.08
            return (
              <div key={s.c.id} className="flex items-center gap-6 border-b border-line py-2 last:border-b-0">
                <Knockoff game={game} variant={s.c.thumbVariant} size={24} />
                <span className="tabular min-w-0 flex-1 truncate font-mono text-micro text-ink">{s.c.placeId}</span>
                <Camera aria-label={shot ? 'Screenshot captured' : 'Screenshot pending'} className={cn('size-12 shrink-0', shot ? 'text-live' : 'text-subtle')} />
                <FileCheck2 aria-label={record ? 'Asset-delivery record stamped' : 'Asset-delivery record pending'} className={cn('size-12 shrink-0', record ? 'text-live' : 'text-subtle')} />
                {record && <span className="shrink-0 rounded-8 border border-live px-4 font-mono text-micro text-live motion-safe:animate-stamp">200</span>}
              </div>
            )
          })}
          {sim.reached('evidence') && (
            <p className="tabular text-micro text-muted">
              Evidence {evidenced} of {TOTALS.auto}
            </p>
          )}
        </div>
      </div>
      <div className="min-h-32 text-micro">
        {sealed ? (
          <p className="text-muted motion-safe:animate-enter">
            Filed under standing attestation signed by {ATTESTATION.short}, {ATTESTATION.signedAt}
            {pending && (
              <span className="ml-8 inline-flex items-center gap-6">
                <Badge tone="warn">Pending</Badge>
                <span className="text-subtle">No edits after submit</span>
              </span>
            )}
          </p>
        ) : (
          <p className="text-subtle">Request {data.requestA} is open until filing</p>
        )}
      </div>
    </div>
  )
}

/* Rights Manager envelope. The flap's tip moves from open (above) to sealed (inside) with `seal`. */
function Envelope({ seal, filled }: { seal: number; filled: boolean }) {
  const tipY = -26 + 72 * seal
  return (
    <svg viewBox="0 -30 128 112" className="h-112 w-128" aria-hidden>
      <rect x="2" y="8" width="124" height="72" rx="8" className={cn('stroke-line-strong', filled ? 'fill-live-soft' : 'fill-raised')} strokeWidth="1.5" />
      <path d="M2 78 L52 42 M126 78 L76 42" className="stroke-line-strong" strokeWidth="1.5" fill="none" />
      <path d={`M2 10 L64 ${tipY} L126 10`} className={cn('stroke-live', seal > 0 ? 'fill-raised' : 'fill-none')} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function ReviewLane({ sim, data, game }: { sim: Simulation; data: Dataset; game: Game }) {
  const n = laneCount(sim, TOTALS.review)
  const rows = data.showcase.filter((s) => s.c.lane === 'review' && sim.t >= s.arrive + HOLD_MS + DROP_MS)
  const decided = (id: string) => {
    const idx = data.runDecisions.findIndex((d) => d.id === id)
    if (idx < 0) return null
    return sim.within('review') >= 0.3 + idx * 0.24 ? data.runDecisions[idx] : null
  }
  return (
    <div className="flex min-w-0 flex-col gap-8 rounded-8 border border-line p-12">
      <LaneHead label="Human review" count={n} tone="warn" />
      <p className="text-micro text-muted">Perceptual matches never auto-file</p>
      {rows.map((s) => {
        const d = decided(s.c.id)
        return (
          <div key={s.c.id} className="flex flex-col gap-4 border-b border-line pb-6 last:border-b-0">
            <div className="flex items-center gap-6">
              <Knockoff game={game} variant={s.c.thumbVariant} size={24} />
              <span className="min-w-0 truncate text-micro font-medium text-ink">{s.c.name}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="font-mono text-micro text-warn">
                {s.c.kind} {s.c.similarity?.toFixed(2)}
              </span>
              {d && (
                <span className="motion-safe:animate-stamp">
                  <Badge tone={d.decision === 'approved' ? 'live' : 'muted'}>{d.decision === 'approved' ? 'Approved' : 'Dismissed'}</Badge>
                </span>
              )}
            </div>
            {d?.decision === 'dismissed' && <span className="text-micro text-muted">Licensed from Creator Store, false positive</span>}
          </div>
        )
      })}
    </div>
  )
}

function ClearedLane({ sim, data, game }: { sim: Simulation; data: Dataset; game: Game }) {
  const n = laneCount(sim, TOTALS.cleared)
  const rows = data.showcase.filter((s) => s.c.lane === 'cleared' && sim.t >= s.arrive + HOLD_MS + DROP_MS)
  return (
    <div className="flex min-w-0 flex-col gap-8 rounded-8 border border-line p-12">
      <LaneHead label="Cleared" count={n} tone="muted" />
      <p className="text-micro text-muted">Toolbox and Creator Store licensed assets are never filed</p>
      {rows.map((s) => (
        <div key={s.c.id} className="flex flex-col gap-4">
          <div className="flex items-center gap-6">
            <Knockoff game={game} variant={s.c.thumbVariant} size={24} />
            <span className="min-w-0 truncate text-micro font-medium text-ink">{s.c.name}</span>
          </div>
          <span className="line-clamp-2 text-micro text-subtle">{s.c.licenseNote}</span>
        </div>
      ))}
    </div>
  )
}

function NoneLane({ sim }: { sim: Simulation }) {
  const n = laneCount(sim, TOTALS.none)
  return (
    <div className="flex min-w-0 flex-col gap-8 rounded-8 border border-dashed border-line p-12">
      <LaneHead label="No match" count={n} tone="ink" />
      <p className="text-micro text-subtle">Compared and discarded. Nothing is filed and nothing is stored beyond the place id.</p>
      <ProgressBar value={n / TOTALS.crawled} tone="muted" size="sm" label="Share of crawled candidates with no match" />
      <span className="tabular text-micro text-subtle">{Math.round((n / TOTALS.crawled) * 100)}% of crawled</span>
    </div>
  )
}
