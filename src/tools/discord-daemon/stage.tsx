import { useId, useMemo } from 'react'
import { Check, CircleAlert, CircleDashed, Clock3, Hash, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp, easeOut, fmtCompact, fmtDay, fmtInt, fmtPct } from '@/lib/format'
import { createRng } from '@/lib/random'
import { toneBg, toneFill, type Tone } from '@/lib/tone'
import type { Simulation } from '@/lib/useSimulation'
import { Badge, Button, Code, ProgressBar } from '@/components/ui'
import { sentimentTone, type DiscordDataset, type Insight } from './data'
import { SentimentValue, TextEquivalent } from './parts'

/* The signature visualization. Every value is a pure function of sim.within(stage), so pause,
   seek, skip and replay all land on the same frame. The one big idea: a message field is not a
   crowd. 4,212 marks collapse into 611 people, one of whom sent 312 of them. */

const FIELD = { x: 8, y: 8, w: 496, h: 292 }
const TRAY = { x: 524, y: 8, w: 188, h: 292 }
const VIEW = { w: 720, h: 308 }

function discOffsets(count: number, radius: number): [number, number][] {
  const out: [number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.5) / Math.max(1, count))
    const a = i * golden
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

function clumpPath(offsets: [number, number][]): string {
  let d = ''
  for (const [x, y] of offsets) d += `M${x.toFixed(1)} ${y.toFixed(1)}h1.7v1.7h-1.7z`
  return d
}

interface Geometry {
  anchors: { x: number; y: number }[]
  clumps: string[]
  piles: { x: number; y: number; radius: number }[]
  pileDots: { x: number; y: number }[][]
  seats: number[]
  tray: { x: number; y: number }[]
  topicTone: Tone[]
}

function buildGeometry(dataset: DiscordDataset): Geometry {
  const crowd = dataset.crowd.people
  const rng = createRng('discord-daemon-' + dataset.gameId + '-field')
  const anchors: { x: number; y: number }[] = []
  const clumps: string[] = []
  for (let i = 0; i < crowd.length; i++) {
    // A jittered lattice still reads as a grid at a glance; people are scattered, so the
    // resting field is scattered too. Seeded, so the shape is identical on every replay.
    anchors.push({
      x: FIELD.x + 10 + rng.float(0, FIELD.w - 20),
      y: FIELD.y + 16 + rng.float(0, FIELD.h - 32),
    })
    clumps.push(clumpPath(discOffsets(crowd[i].messages, 10 + Math.sqrt(crowd[i].messages) * 3.2)))
  }
  const heavyIndex = crowd.findIndex((p) => p.heavy)
  if (heavyIndex >= 0) {
    anchors[heavyIndex] = { x: FIELD.x + FIELD.w * 0.52, y: FIELD.y + FIELD.h * 0.46 }
  }
  const pilePositions = [
    { x: 0.17, y: 0.26 },
    { x: 0.5, y: 0.24 },
    { x: 0.83, y: 0.27 },
    { x: 0.19, y: 0.74 },
    { x: 0.5, y: 0.76 },
    { x: 0.82, y: 0.73 },
  ]
  const piles = pilePositions.map((p) => ({ x: FIELD.x + p.x * FIELD.w, y: FIELD.y + p.y * FIELD.h, radius: 26 }))
  const pileDots = dataset.topics.map((topic, i) => discOffsets(Math.max(1, topic.people), piles[i].radius).map(([dx, dy]) => ({ x: piles[i].x + dx, y: piles[i].y + dy })))
  const seats: number[] = []
  const counters = dataset.topics.map(() => 0)
  for (const person of crowd) {
    const t = person.topicIndex
    seats.push(counters[t] ?? 0)
    counters[t] = (counters[t] ?? 0) + 1
  }
  const excludedCount = crowd.filter((p) => p.kind !== 'member').length
  const trayCols = 6
  const trayRows = Math.max(1, Math.ceil(excludedCount / trayCols))
  const trayTop = TRAY.y + 64
  const trayHeight = TRAY.h - 74
  const tray: { x: number; y: number }[] = []
  for (let i = 0; i < excludedCount; i++) {
    const r = Math.floor(i / trayCols)
    const c = i % trayCols
    tray.push({
      x: TRAY.x + 18 + (c + 0.5) * ((TRAY.w - 36) / trayCols),
      y: trayTop + ((r + 0.5) / Math.max(1, trayRows)) * trayHeight,
    })
  }
  return {
    anchors,
    clumps,
    piles,
    pileDots,
    seats,
    tray,
    topicTone: dataset.topics.map((t) => sentimentTone(t.sentiment) as Tone),
  }
}

export function StageVisual({
  sim,
  dataset,
  onOpenQuotes,
}: {
  sim: Simulation
  dataset: DiscordDataset
  onOpenQuotes: (topicId: string | null, title: string, total: number) => void
}) {
  const stageId = sim.stage?.id ?? 'tldr'
  if (stageId === 'connect') return <ConnectStage progress={sim.within('connect')} dataset={dataset} />
  if (stageId === 'backfill') return <BackfillStage progress={sim.within('backfill')} dataset={dataset} />
  if (stageId === 'mood') return <MoodStage progress={sim.within('mood')} dataset={dataset} />
  if (stageId === 'tldr') return <TldrStage progress={sim.within('tldr')} dataset={dataset} onOpenQuotes={onOpenQuotes} />
  return <PeopleStage sim={sim} dataset={dataset} />
}

/* ---------------- headline ---------------- */

function Headline({ sim, dataset }: { sim: Simulation; dataset: DiscordDataset }) {
  const peopleP = sim.within('people')
  const clusterP = sim.within('cluster')
  const morph = clamp((peopleP - 0.26) / 0.3)
  const counted = Math.round(dataset.window.messages + (dataset.window.people - dataset.window.messages) * morph)
  const showPeople = morph >= 0.35
  const negative = dataset.window.negativeMessageShare + (dataset.window.negativePeopleShare - dataset.window.negativeMessageShare) * morph
  return (
    <div className="flex flex-wrap items-end justify-between gap-16">
      <div className="flex flex-wrap items-end gap-32">
        <div>
          <div className="text-micro text-muted">{showPeople ? 'People counted, 24h' : 'Messages scanned, 24h'}</div>
          <div className="tabular text-headline text-ink">{fmtInt(counted)}</div>
        </div>
        <div>
          <div className="text-micro text-muted">Negative share</div>
          <div className={cn('tabular text-headline', dataset.metadataOnly ? 'text-subtle' : negative <= 0.18 ? 'text-warn' : 'text-danger')}>
            {dataset.metadataOnly ? 'No content' : fmtPct(negative, 0)}
          </div>
        </div>
        <div>
          <div className="text-micro text-muted">Accounts posting</div>
          <div className="tabular text-headline text-muted">{fmtInt(dataset.window.accounts)}</div>
        </div>
        {clusterP > 0 && (
          <div>
            <div className="text-micro text-muted">Topic clusters</div>
            <div className="tabular text-headline text-ink">{dataset.topics.length}</div>
          </div>
        )}
      </div>
      <Badge tone={showPeople ? 'live' : 'accent'} dot pulse={sim.status === 'running'}>
        {showPeople ? 'One person, one vote' : 'Message-weighted'}
      </Badge>
    </div>
  )
}

/* ---------------- people + cluster field ---------------- */

function PeopleStage({ sim, dataset }: { sim: Simulation; dataset: DiscordDataset }) {
  const clipId = useId().replace(/:/g, '')
  const geometry = useMemo(() => buildGeometry(dataset), [dataset])
  const peopleP = sim.within('people')
  const clusterP = sim.within('cluster')
  const collapse = clamp((peopleP - 0.04) / 0.56)
  const trayP = easeOut(clamp((peopleP - 0.22) / 0.4))
  const drift = easeOut(clamp((clusterP - 0.28) / 0.66))
  const chipOpacity = clamp((drift - 0.5) / 0.35)
  const heavyTagOpacity = clamp((peopleP - 0.45) / 0.12) * (1 - clamp(drift * 2))
  const clumpScale = 1 - collapse * 0.96
  const heavyIndex = dataset.crowd.people.findIndex((p) => p.heavy)
  const heavyDot = geometry.anchors[heavyIndex] ?? { x: FIELD.x + FIELD.w / 2, y: FIELD.y + FIELD.h / 2 }
  const raid = dataset.exclusions.find((e) => e.kind === 'raid')
  const staff = dataset.exclusions.find((e) => e.kind === 'staff')
  const bot = dataset.exclusions.find((e) => e.kind === 'bot')
  const excluded = dataset.crowd.people
    .map((person, index) => ({ person, index }))
    .filter(({ person }) => person.kind !== 'member')
  return (
    <div className="flex flex-col gap-16">
      <Headline sim={sim} dataset={dataset} />
      <figure className="m-0">
        <svg
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          role="img"
          aria-label={`Message field. ${fmtInt(dataset.window.messages)} messages from ${fmtInt(dataset.window.accounts)} accounts collapse into ${fmtInt(dataset.window.people)} people. ${dataset.exclusions
            .map((e) => `${e.accounts} ${e.kind} accounts move to the excluded tray`)
            .join(', ')}.`}
          className="h-auto w-full overflow-visible"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} rx={8} />
            </clipPath>
          </defs>
          <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} rx={8} className="fill-sunken" />
          <rect x={TRAY.x} y={TRAY.y} width={TRAY.w} height={TRAY.h} rx={8} className="fill-sunken stroke-line-strong" strokeDasharray="4 4" strokeWidth={1} />
          <g clipPath={`url(#${clipId})`}>
            {dataset.crowd.people.map((person, i) => {
              if (person.kind !== 'member') return null
              const anchor = geometry.anchors[i]
              return (
                <g key={person.index} transform={`translate(${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)}) scale(${clumpScale.toFixed(3)})`} opacity={1 - collapse}>
                  <path d={geometry.clumps[i]} className="fill-line-strong" />
                </g>
              )
            })}
            {dataset.crowd.people.map((person, i) => {
              if (person.kind !== 'member') return null
              const anchor = geometry.anchors[i]
              const pile = geometry.piles[person.topicIndex] ?? geometry.piles[0]
              const dots = geometry.pileDots[person.topicIndex] ?? geometry.pileDots[0]
              const target = dots[geometry.seats[i] % Math.max(1, dots.length)] ?? pile
              const x = anchor.x + (target.x - anchor.x) * drift
              const y = anchor.y + (target.y - anchor.y) * drift
              const radius = person.heavy ? 3.2 + 7 * (1 - collapse) : 3.2
              return (
                <circle
                  key={`rep-${person.index}`}
                  cx={x.toFixed(1)}
                  cy={y.toFixed(1)}
                  r={radius.toFixed(2)}
                  opacity={clamp((collapse - 0.2) / 0.5)}
                  className={drift > 0.35 ? toneFill[geometry.topicTone[person.topicIndex] ?? 'muted'] : 'fill-muted'}
                />
              )
            })}
          </g>
          {excluded.map(({ person, index }, trayIndex) => {
            const anchor = geometry.anchors[index]
            const target = geometry.tray[trayIndex] ?? { x: TRAY.x + TRAY.w / 2, y: TRAY.y + TRAY.h / 2 }
            const x = anchor.x + (target.x - anchor.x) * trayP
            const y = anchor.y + (target.y - anchor.y) * trayP
            return (
              <circle
                key={`ex-${person.index}`}
                cx={x.toFixed(1)}
                cy={y.toFixed(1)}
                r={3.2}
                opacity={clamp((collapse - 0.15) / 0.4)}
                className={person.kind === 'staff' ? 'fill-accent-ink' : person.kind === 'bot' ? 'fill-subtle' : 'fill-muted'}
              />
            )
          })}
          {geometry.piles.map((pile, i) => {
            const topic = dataset.topics[i]
            if (!topic) return null
            const width = topic.category.length * 6.3 + 16
            return (
              <g key={topic.id} opacity={chipOpacity} transform={`translate(${pile.x.toFixed(1)} ${(pile.y + pile.radius + 16).toFixed(1)})`}>
                <rect x={-width / 2} y={-11} width={width} height={22} rx={8} className="fill-raised" />
                <text textAnchor="middle" y={4} className={cn('text-micro', toneFill[geometry.topicTone[i] ?? 'muted'])}>
                  {topic.category}
                </text>
              </g>
            )
          })}
          <text x={TRAY.x + 14} y={TRAY.y + 22} className="fill-muted text-micro">
            Excluded
          </text>
          <g opacity={trayP}>
            {raid && (
              <text x={TRAY.x + 14} y={TRAY.y + 42} className="fill-muted text-micro">
                {raid.accounts} raid accounts
              </text>
            )}
            {staff && (
              <text x={TRAY.x + 14} y={TRAY.y + 58} className="fill-accent-ink text-micro">
                {staff.accounts} staff
              </text>
            )}
            {bot && (
              <text x={TRAY.x + 104} y={TRAY.y + 58} className="fill-subtle text-micro">
                {bot.accounts} bots
              </text>
            )}
          </g>
          <g opacity={heavyTagOpacity} transform={`translate(${Math.min(heavyDot.x + 14, FIELD.x + FIELD.w - 132).toFixed(1)} ${(heavyDot.y - 20).toFixed(1)})`}>
            <rect x={0} y={-12} width={126} height={40} rx={8} className="fill-raised stroke-line-strong" strokeWidth={1} />
            <text x={8} y={2} className="fill-ink text-micro">
              {dataset.heavyPoster.handle}
            </text>
            <text x={8} y={18} className="fill-warn text-micro">
              {fmtInt(dataset.heavyPoster.messages)} messages, 1 voice
            </text>
          </g>
        </svg>
        <figcaption>
          <p className="mt-8 text-micro text-muted">
            {drift > 0.5 ? `${dataset.topics.length} topic piles, coloured by sentiment.` : collapse > 0.55 ? 'One dot per person. Staff, raids and bots sit in the excluded tray.' : 'Every mark is one message, placed around the person who sent it.'}
          </p>
          <TextEquivalent>
            {fmtInt(dataset.window.messages)} messages from {fmtInt(dataset.window.accounts)} accounts collapse into {fmtInt(dataset.window.people)} people. {dataset.heavyPoster.handle} sent{' '}
            {fmtInt(dataset.heavyPoster.messages)} of them and is now one dot with one vote. The people count is the read behind every number on this page.
          </TextEquivalent>
        </figcaption>
      </figure>
      {drift > 0 && (
        <ul className="grid grid-cols-2 gap-8 md:grid-cols-3">
          {dataset.topics.map((topic, i) => (
            <li key={topic.id} className="flex min-w-0 items-center gap-8 border-b border-line px-8 py-6 last:border-b-0">
              <span aria-hidden className={cn('size-8 shrink-0 rounded-full', toneBg[geometry.topicTone[i] ?? 'muted'])} />
              <span className="min-w-0 flex-1 truncate text-micro text-ink">{topic.label}</span>
              <span className="tabular shrink-0 font-mono text-micro text-muted">{fmtInt(topic.people)}</span>
              <SentimentValue value={topic.sentiment} available={!dataset.metadataOnly} className="text-micro" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------------- connect ---------------- */

function IntentChip({ label, bit, note, state, lit }: { label: string; bit: string; note: string; state: 'ok' | 'approved' | 'denied'; lit: boolean }) {
  const Icon = state === 'denied' ? TriangleAlert : state === 'approved' ? ShieldCheck : Check
  return (
    <li className={cn('flex min-w-0 items-start gap-8 border-b border-line py-12 last:border-b-0', lit && state === 'denied' && 'text-warn')}>
      <Icon aria-hidden className={cn('mt-2 size-16 shrink-0', lit ? (state === 'denied' ? 'text-warn' : state === 'approved' ? 'text-live' : 'text-accent-ink') : 'text-subtle')} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-8">
          <span className="font-mono text-micro text-ink">{label}</span>
          <Code>{bit}</Code>
          {lit && state === 'approved' && <Badge tone="live">approved</Badge>}
          {lit && state === 'denied' && <Badge tone="warn">4014</Badge>}
          {!lit && <span className="text-micro text-subtle">checking</span>}
        </span>
        <span className={cn('mt-4 block text-micro', lit ? 'text-muted' : 'text-subtle')}>{note}</span>
      </span>
    </li>
  )
}

function ConnectStage({ progress, dataset }: { progress: number; dataset: DiscordDataset }) {
  const denied = dataset.metadataOnly
  const channels = dataset.channels.length
  const chips = [
    { label: 'GUILD_MESSAGES', bit: '1<<9', note: 'Channel message events and REST reads in every public channel.', state: 'ok' as const },
    denied
      ? { label: 'MESSAGE_CONTENT', bit: '1<<15', note: 'Not approved. Content arrives empty, so only metadata analytics run.', state: 'denied' as const }
      : { label: 'MESSAGE_CONTENT', bit: '1<<15', note: 'Approved as a privileged intent. Content is read, then discarded.', state: 'approved' as const },
    { label: 'READ_MESSAGE_HISTORY', bit: 'granted', note: 'Reads the 7-day window, never direct messages.', state: 'ok' as const },
  ]
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-start justify-between gap-16">
        <div>
          <div className="text-title font-bold text-ink">{dataset.server.name}</div>
          <div className="text-micro text-muted">Connected server</div>
          <p className="mt-4 max-w-prose text-label text-muted">
            {fmtCompact(dataset.server.members)} members. The bot joins with scope <Code>bot</Code> and <Code>applications.commands</Code>, and asks for three intents.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-8">
          <Badge tone="live" dot pulse>
            Gateway connected
          </Badge>
          <span className="inline-flex items-center gap-6 rounded-full border border-dashed border-warn px-8 py-2 text-micro text-warn">
            <CircleDashed aria-hidden className="size-12" />
            4014 handled
          </span>
        </span>
      </div>
      <ul className="flex flex-col rounded-8 border border-line bg-sunken px-12 py-4">
        {chips.map((chip, i) => (
          <IntentChip key={chip.label} label={chip.label} bit={chip.bit} note={chip.note} state={chip.state} lit={progress > 0.18 + i * 0.22} />
        ))}
      </ul>
      <div className="rounded-8 border border-line bg-sunken px-12 py-8">
        <div className="flex items-center justify-between gap-8">
          <span className="flex items-center gap-8 text-micro text-muted">
            <KeyRound aria-hidden className="size-14 text-muted" />
            Bot invite
          </span>
          <span className="font-mono text-micro text-subtle">intents=33281</span>
        </div>
        <p className="mt-4 break-all font-mono text-micro text-ink">discord.com/oauth2/authorize?client_id=1248003125000000001&scope=bot+applications.commands&permissions=66560</p>
        <p className="mt-4 text-micro text-muted">Permissions: View Channels, Read Message History. The bot cannot post, ban or read direct messages.</p>
      </div>
      {denied && (
        <div className="flex items-start gap-12 rounded-8 border border-warn bg-warn-soft px-12 py-8">
          <CircleAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
          <p className="text-label text-ink">
            MESSAGE_CONTENT is not approved: content arrives empty; only metadata analytics are available.
            <span className="mt-4 block text-micro text-muted">Every sentiment number on this page is replaced by a metadata read, and the connect dialog can switch it back.</span>
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-12 border-t border-line pt-12">
        <span className="text-micro text-muted">Reading {channels} public channels, next: backfill 7 days at limit 100.</span>
        <span className="tabular font-mono text-micro text-muted">
          {Math.round(progress * channels)} / {channels} channels indexed
        </span>
      </div>
    </div>
  )
}

/* ---------------- backfill ---------------- */

function BackfillStage({ progress, dataset }: { progress: number; dataset: DiscordDataset }) {
  const rows = dataset.channels.map((channel, i) => {
    const start = i * 0.13
    const local = clamp((progress - start) / 0.3)
    return { ...channel, local, pages: Math.max(1, Math.ceil(channel.messages / 100)) }
  })
  const totalPages = rows.reduce((a, r) => a + r.pages, 0)
  const limiting = progress > 0.34 && progress < 0.58
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <div className="text-title font-bold text-ink">Backfill 7 days</div>
          <div className="text-micro text-muted">Get Channel Messages, limit 100</div>
        </div>
        <div className="flex flex-wrap items-center gap-16">
          <span className="tabular font-mono text-label text-ink">
            {fmtInt(Math.round(dataset.window.messages * easeOut(progress)))} / {fmtInt(dataset.window.messages)} messages
          </span>
          <Badge tone={limiting ? 'warn' : 'live'} dot pulse={limiting}>
            {limiting ? '429 retry 1.2s' : 'Streaming'}
          </Badge>
        </div>
      </div>
      <ul className="flex flex-col">
        {rows.map((row, i) => {
          const limited = i === 2 && limiting
          const done = row.local >= 1
          return (
            <li key={row.id} className="flex items-center gap-12 border-b border-line py-8 last:border-b-0">
              <Hash aria-hidden className={cn('size-14 shrink-0', done ? 'text-live' : 'text-subtle')} />
              <span className="w-120 shrink-0 truncate font-mono text-micro text-ink">{row.name}</span>
              <span className="tabular w-64 shrink-0 text-right font-mono text-micro text-muted">{fmtInt(Math.round(row.messages * easeOut(row.local)))}</span>
              <span className="flex min-w-0 flex-1 items-center gap-8">
                <ProgressBar value={row.local} tone={limited ? 'warn' : done ? 'live' : 'accent'} size="sm" label={`${row.name} backfill`} />
                <span className="tabular w-72 shrink-0 font-mono text-micro text-subtle">
                  {Math.round(row.pages * easeOut(row.local))} / {row.pages} pages
                </span>
              </span>
              <span className="w-112 shrink-0 text-right">
                {limited ? (
                  <Badge tone="warn">429 retry_after 1.2</Badge>
                ) : done ? (
                  <span className="inline-flex items-center gap-6 text-micro text-live">
                    <Check aria-hidden className="size-12" /> done
                  </span>
                ) : (
                  <span className="text-micro text-subtle">limit=100</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-12 rounded-8 border border-line bg-sunken px-12 py-8">
        <span className="flex items-center gap-8 text-micro text-muted">
          <Clock3 aria-hidden className="size-14" />
          X-RateLimit-Remaining 0 on the #trading bucket, retry honoured once
        </span>
        <span className="tabular font-mono text-micro text-muted">
          {Math.round(totalPages * easeOut(progress))} / {totalPages} pages
        </span>
      </div>
    </div>
  )
}

/* ---------------- mood ---------------- */

function MoodStage({ progress, dataset }: { progress: number; dataset: DiscordDataset }) {
  const series = dataset.mood.series
  const drop = dataset.mood.drops[0]
  const chart = { x: 52, y: 24, w: 648, h: 184 }
  const min = -0.28
  const max = 0.3
  const xAt = (i: number) => chart.x + (i / (series.length - 1)) * chart.w
  const yAt = (v: number) => chart.y + ((max - v) / (max - min)) * chart.h
  const line = series.map((point, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(point.sentiment).toFixed(1)}`).join(' ')
  const dipIndex = series.findIndex((p) => p.date === '2026-10-23')
  const causes = drop.causes.map((cause) => ({ ...cause, topic: dataset.topics.find((t) => t.id === cause.topicId) })).filter((c) => c.topic)
  const draw = easeOut(progress)
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <div className="text-title font-bold text-ink">Mood timeline</div>
          <div className="text-micro text-muted">People-weighted, Oct 19 to Oct 26</div>
        </div>
        <span className="tabular font-mono text-label text-danger">Oct 23 {dataset.metadataOnly ? 'delta unavailable' : 'delta -0.21'}</span>
      </div>
      {dataset.metadataOnly ? (
        <div className="flex min-h-240 flex-col items-start justify-center gap-12 rounded-8 border border-warn bg-warn-soft px-24 py-24">
          <CircleAlert aria-hidden className="size-20 text-warn" />
          <p className="max-w-prose text-label text-ink">
            Sentiment needs message content. This run counted authors and channels, so the mood line stays empty until MESSAGE_CONTENT is approved.
          </p>
          <p className="text-micro text-muted">Reconnect with MESSAGE_CONTENT approved to read the 7-day line and its ranked causes.</p>
        </div>
      ) : (
        <>
          <figure className="m-0 min-w-0">
            <svg viewBox="0 0 720 250" role="img" aria-label="Daily sentiment from Oct 19 to Oct 26, people-weighted. Sentiment falls on Oct 23 by 0.21, the largest drop of the week." className="h-auto w-full">
              {[0.2, 0, -0.2].map((v) => (
                <g key={v}>
                  <line x1={chart.x} y1={yAt(v)} x2={chart.x + chart.w} y2={yAt(v)} className="stroke-line" strokeWidth={1} />
                  <text x={chart.x - 10} y={yAt(v) + 4} textAnchor="end" className="fill-subtle text-micro">
                    {v.toFixed(1)}
                  </text>
                </g>
              ))}
              <line x1={chart.x} y1={yAt(0)} x2={chart.x + chart.w} y2={yAt(0)} className="stroke-line-strong" strokeWidth={1} />
              <path d={`${line} L${xAt(series.length - 1)} ${chart.y + chart.h} L${chart.x} ${chart.y + chart.h} Z`} className="fill-accent-soft" opacity={draw * 0.8} />
              <path d={line} fill="none" pathLength={1} strokeDasharray={`${draw} 1`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-ink" />
              {series.map((point, i) => (
                <circle key={point.date} cx={xAt(i)} cy={yAt(point.sentiment)} r={3.5} opacity={clamp((draw - i / series.length) * 5)} className={i === dipIndex ? 'fill-danger' : 'fill-accent-ink'} />
              ))}
              {dipIndex >= 0 && (
                <g opacity={clamp((progress - 0.4) / 0.2)}>
                  <line x1={xAt(dipIndex)} y1={yAt(series[dipIndex].sentiment)} x2={xAt(dipIndex)} y2={chart.y + chart.h} className="stroke-danger" strokeWidth={1} strokeDasharray="3 3" />
                  <text x={xAt(dipIndex)} y={chart.y + chart.h + 34} textAnchor="middle" className="fill-danger text-micro">
                    Oct 23
                  </text>
                </g>
              )}
              {series.map((point, i) => (
                <text key={`x-${point.date}`} x={xAt(i)} y={chart.y + chart.h + 20} textAnchor="middle" className="fill-subtle text-micro">
                  {fmtDay(point.date + 'T12:00:00Z')}
                </text>
              ))}
            </svg>
            <TextEquivalent>
              Oct 19 +0.20, Oct 20 +0.11, Oct 21 +0.16, Oct 22 +0.09, Oct 23 -0.12, Oct 24 -0.04, Oct 25 +0.03, Oct 26 +0.08. The Oct 23 drop is 0.21.
            </TextEquivalent>
          </figure>
          <section>
            <div className="flex flex-wrap items-center justify-between gap-8">
              <h3 className="text-label font-medium text-ink">Likely causes of the Oct 23 dip</h3>
              <Badge tone="warn">{Math.round(causes.reduce((a, c) => a + c.confidence, 0))}% attributed</Badge>
            </div>
            <ul className="mt-8 flex flex-col">
              {causes.map((cause, i) => {
                const local = easeOut(clamp((progress - 0.48 - i * 0.08) / 0.16))
                const scale = 1 + (1 - local) * 0.3
                return (
                  <li key={cause.topicId} style={{ opacity: local, transform: `scale(${scale.toFixed(3)})` }} className="grid origin-left gap-8 border-b border-line py-12 last:border-b-0 md:grid-cols-12">
                    <div className="md:col-span-5">
                      <p className="text-label text-ink">
                        {i + 1}. {cause.topic?.label}
                      </p>
                      <p className="mt-2 text-micro text-muted">{cause.topic?.channel}</p>
                    </div>
                    <div className="md:col-span-5">
                      <div className="flex items-baseline justify-between gap-8">
                        <span className="text-micro text-muted">share of the drop</span>
                        <span className="tabular font-mono text-label text-warn">{cause.confidence}%</span>
                      </div>
                      <div className="mt-6 h-6 overflow-hidden rounded-full bg-raised">
                        <div className="h-full origin-left rounded-full bg-warn" style={{ transform: `scaleX(${cause.confidence / 100})` }} />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      {i === 0 && <p className="text-micro text-muted">Hack Daemon saw the same surge: 18 videos, 1.4M views, rising.</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="mt-8 text-micro text-muted">Ranked from message overlap and timing. A cause is a hypothesis, not a proven effect.</p>
          </section>
        </>
      )}
    </div>
  )
}

/* ---------------- tldr ---------------- */

function TldrStage({ progress, dataset, onOpenQuotes }: { progress: number; dataset: DiscordDataset; onOpenQuotes: (topicId: string | null, title: string, total: number) => void }) {
  const insights = dataset.insights.slice(0, 6)
  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <div className="text-title font-bold text-ink">Six insights worth a decision</div>
          <div className="text-micro text-muted">Nightly summary, {fmtInt(dataset.window.messages)} messages weighed to {fmtInt(dataset.window.people)} people</div>
        </div>
        <Badge tone={dataset.metadataOnly ? 'warn' : 'live'} dot pulse={false}>
          {dataset.metadataOnly ? 'Metadata only' : 'Content read, then discarded'}
        </Badge>
      </div>
      <SettledBand dataset={dataset} />
      <ul className="flex flex-col">
        {insights.map((insight, i) => (
          <InsightRow key={insight.id} insight={insight} local={easeOut(clamp((progress - i * 0.09) / 0.2))} onOpenQuotes={onOpenQuotes} />
        ))}
      </ul>
      <DailyVolumeStrip dataset={dataset} progress={progress} />
    </div>
  )
}

/* The final read. When the run ends on the TL;DR stage, the settled people field stays on the
   stage so the end state still shows the one idea that makes every number trustworthy: 611
   people, not 4,212 messages, with raids, staff and bots held out. */
function SettledBand({ dataset }: { dataset: DiscordDataset }) {
  const geometry = useMemo(() => buildGeometry(dataset), [dataset])
  const members = dataset.crowd.people.map((person, index) => ({ person, index })).filter(({ person }) => person.kind === 'member')
  const excluded = dataset.crowd.people.map((person, index) => ({ person, index })).filter(({ person }) => person.kind !== 'member')
  const raid = dataset.exclusions.find((e) => e.kind === 'raid')
  const staff = dataset.exclusions.find((e) => e.kind === 'staff')
  const bot = dataset.exclusions.find((e) => e.kind === 'bot')
  const yAt = (value: number) => 30 + ((value - FIELD.y) / FIELD.h) * 88
  const trayYAt = (value: number) => 30 + ((value - (TRAY.y + 64)) / (TRAY.h - 74)) * 70
  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 720 132"
        role="img"
        aria-label={`Final read. ${fmtInt(dataset.window.messages)} messages from ${fmtInt(dataset.window.accounts)} accounts became ${fmtInt(dataset.window.people)} people, ${fmtPct(dataset.window.negativePeopleShare, 0)} negative. ${fmtInt(raid?.accounts ?? 0)} raid accounts, ${fmtInt(staff?.accounts ?? 0)} staff and ${fmtInt(bot?.accounts ?? 0)} bots are held out in the excluded tray.`}
        className="h-auto w-full"
      >
        <rect x={0} y={0} width={508} height={132} rx={8} className="fill-sunken" />
        <rect x={524} y={0} width={188} height={132} rx={8} className="fill-sunken stroke-line-strong" strokeDasharray="4 4" strokeWidth={1} />
        <text x={12} y={18} className="fill-muted text-micro">{fmtInt(dataset.window.people)} people, one dot each</text>
        {members.map(({ person, index }) => (
          <circle key={`settled-${person.index}`} cx={geometry.anchors[index].x.toFixed(1)} cy={yAt(geometry.anchors[index].y).toFixed(1)} r={2.4} className="fill-muted" />
        ))}
        <text x={536} y={18} className="fill-muted text-micro">Excluded</text>
        {excluded.map(({ person, index }, i) => {
          const seat = geometry.tray[i] ?? { x: 612, y: 110 }
          return (
            <circle
              key={`held-${person.index}`}
              cx={seat.x.toFixed(1)}
              cy={trayYAt(seat.y).toFixed(1)}
              r={2.2}
              className={person.kind === 'staff' ? 'fill-accent-ink' : person.kind === 'bot' ? 'fill-subtle' : 'fill-muted'}
            />
          )
        })}
        {raid && <text x={536} y={112} className="fill-muted text-micro">{fmtInt(raid.accounts)} raid</text>}
        {staff && <text x={600} y={112} className="fill-accent-ink text-micro">{fmtInt(staff.accounts)} staff</text>}
        {bot && <text x={536} y={126} className="fill-subtle text-micro">{fmtInt(bot.accounts)} bots</text>}
      </svg>
      <figcaption>
        <TextEquivalent>
          The final read. {fmtInt(dataset.window.messages)} messages from {fmtInt(dataset.window.accounts)} accounts became {fmtInt(dataset.window.people)} people,{' '}
          {fmtPct(dataset.window.negativePeopleShare, 0)} of them negative. Raid, staff and bot accounts sit in the excluded tray and count as zero voices.
        </TextEquivalent>
      </figcaption>
    </figure>
  )
}

function InsightRow({ insight, local, onOpenQuotes }: { insight: Insight; local: number; onOpenQuotes: (topicId: string | null, title: string, total: number) => void }) {
  const tone = insight.severity === 'danger' ? 'danger' : insight.severity === 'warn' ? 'warn' : insight.severity === 'ok' ? 'live' : 'accent'
  return (
    <li style={{ opacity: local, transform: `translateY(${((1 - local) * 8).toFixed(1)}px)` }} className="border-b border-line py-8 last:border-b-0">
      <div className="flex items-start gap-12">
        <span aria-hidden className={cn('mt-6 size-8 shrink-0 rounded-full', toneBg[tone])} />
        <div className="min-w-0 flex-1">
          <p className="text-label font-medium text-ink">{insight.title}</p>
          <p className="mt-2 line-clamp-2 text-micro text-muted">{insight.detail}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onOpenQuotes(insight.topicId, insight.title, insight.messageCount)} className="shrink-0">
          View {fmtInt(insight.messageCount)} messages
        </Button>
      </div>
    </li>
  )
}


function DailyVolumeStrip({ dataset, progress }: { dataset: DiscordDataset; progress: number }) {
  const days = dataset.release.series
  const peak = Math.max(...days.map((d) => d.messages), 1)
  const light = easeOut(clamp((progress - 0.55) / 0.3))
  return (
    <section aria-label="Messages per day this week" className="mt-8 rounded-8 border border-line bg-sunken px-12 py-8">
      <div className="flex flex-wrap items-center justify-between gap-8">
        <h3 className="text-micro text-muted">Messages per day this week</h3>
        <span className="tabular font-mono text-micro text-subtle">{fmtInt(dataset.window.messages)} total</span>
      </div>
      <ul className="mt-8 grid grid-cols-8 items-end gap-8">
        {days.map((day) => {
          const dip = day.day === 'Oct 23'
          return (
            <li key={day.day} className="flex min-w-0 flex-col items-center gap-4">
              <span className="tabular font-mono text-micro text-subtle">{fmtInt(day.messages)}</span>
              <span className="flex h-48 w-full items-end overflow-hidden rounded-8 bg-raised">
                <span
                  className={dip ? 'w-full origin-bottom rounded-8 bg-danger' : 'w-full origin-bottom rounded-8 bg-accent'}
                  style={{ height: `${Math.round((day.messages / peak) * 100)}%`, transform: `scaleY(${light.toFixed(3)})` }}
                />
              </span>
              <span className="truncate text-micro text-muted">{day.day}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-8 text-micro text-muted">Oct 23 in red: the day sentiment dropped 0.21 and the dupe thread peaked.</p>
    </section>
  )
}
