/* The signature visualization: the sponsorship split.
   Forty-eight 16:9 tiles sit on one timeline. Flagged uploads lift out of the organic lane into
   the paid lane while an engagement gauge climbs above one lane and sinks above the other, and
   a stamp lands between them with the comparison the studio pays for.

   Every value is a pure function of sim.t (via sim.within), so pause, seek, skip and replay all
   land on the same frame. Transforms come from scripted progress, never from layout. */

import { Gauge, Lock, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp, easeOut, fmtCompact, fmtInt, fmtLogTime, fmtMinSec, fmtPct } from '@/lib/format'
import { useReducedMotion } from '@/lib/hooks'
import { toneStroke, toneText, type Tone } from '@/lib/tone'
import type { Simulation } from '@/lib/useSimulation'
import { revealed } from '@/lib/useSimulation'
import type { Game } from '@/data/games'
import { Avatar, Badge, Button, EmptyState, LogStream, NumberTicker, ProgressBar, Skeleton, useToast } from '@/components/ui'
import { apiTitle, DotField, GradeChip, Meter, ModelledTag } from './bits'
import { AS_OF, fmtReach, isSponsored, sponsorHeadline, sponsorDelta, realReach, type Creator, type UploadRow } from './data'
import { logLines } from './log'

const GAUGE_MAX = 0.1
const LANE_COLUMNS = 'grid grid-cols-4 gap-6 sm:grid-cols-8'

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const rad = (a: number) => (a * Math.PI) / 180
  const x0 = cx + r * Math.cos(rad(a0))
  const y0 = cy + r * Math.sin(rad(a0))
  const x1 = cx + r * Math.cos(rad(a1))
  const y1 = cy + r * Math.sin(rad(a1))
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function Tile({
  row,
  opacity,
  badges,
  paid,
  className,
}: {
  row: UploadRow
  opacity: number
  /** 0..1 opacity of the duration and madeForKids badges, scripted by the crawl stage. */
  badges: number
  paid: boolean
  className?: string
}) {
  return (
    <div
      data-slot="upload-tile"
      title={`${row.title}. views ${fmtInt(row.viewCount)} (statistics.viewCount), likes ${fmtInt(row.likeCount)} (statistics.likeCount), duration ${fmtMinSec(row.durationSec)} (contentDetails.duration), made for kids ${row.madeForKids} (status.madeForKids), as of ${AS_OF}`}
      style={{ opacity }}
      className={cn('relative aspect-video overflow-hidden rounded-8 border bg-raised', paid ? 'border-warn' : 'border-line', className)}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="tabular font-mono text-micro font-medium text-ink">{fmtCompact(row.viewCount)}</span>
      </span>
      {row.madeForKids && (
        <span style={{ opacity: badges }} className="absolute left-2 top-2 hidden rounded-8 bg-canvas px-4 text-micro text-muted sm:block">
          Kids
        </span>
      )}
      <span style={{ opacity: badges }} className="absolute bottom-2 right-2 rounded-8 bg-canvas px-4 font-mono text-micro text-muted">
        {fmtMinSec(row.durationSec)}
      </span>
      {paid && <span className="absolute right-2 top-2 rounded-8 bg-warn-soft px-4 text-micro font-medium text-warn">Paid</span>}
    </div>
  )
}

function MiniHatchBar({ label, pct, pending, wide }: { label: string; pct: number; pending?: boolean; wide?: boolean }) {
  return (
    <div className="flex items-center gap-8">
      <span className={(wide ? 'w-96' : 'w-48') + ' shrink-0 truncate text-micro text-muted'} title={label}>
        {label}
      </span>
      {pending ? (
        <Skeleton className="h-6 min-w-0 flex-1 rounded-full" />
      ) : (
        <span className="block h-6 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
          <span className="block h-full rounded-full bg-data-5-soft text-data-5 hatch" style={{ width: `${clamp(pct / 100) * 100}%` }} />
        </span>
      )}
      {pending ? <Skeleton className="h-10 w-32" /> : <span className="tabular w-32 shrink-0 text-right font-mono text-micro text-ink">{Math.round(pct)}%</span>}
    </div>
  )
}

export function CreatorStage({ sim, creator, game }: { sim: Simulation; creator: Creator; game: Game }) {
  const d = creator.dossier
  const { push } = useToast()
  const reduced = useReducedMotion()

  const started = sim.status !== 'idle'
  const resolveP = sim.within('resolve')
  const statsP = easeOut(sim.within('stats'))
  const crawlP = sim.within('crawl')
  const sponsorP = sim.within('sponsor')
  const audienceP = easeOut(sim.within('audience'))
  const credP = sim.within('credibility')
  const scoreP = easeOut(sim.within('score'))
  const compileP = sim.within('compile')

  const handleChars = started ? Math.ceil(d.handle.length * resolveP) : 0
  const showId = resolveP > 0.62
  const showGrade = resolveP > 0.82
  const visibleTiles = started ? Math.round(48 * crawlP) : 0
  const badgeOpacity = clamp((crawlP - 0.5) * 4)

  const sponsoredRows = creator.uploads.filter(isSponsored)
  const organicCount = creator.uploads.length - sponsoredRows.length

  const organicEr = 0.012 + (d.erOrganic - 0.012) * easeOut(sponsorP)
  const sponsoredEr = d.erOrganic + (d.erSponsored - d.erOrganic) * easeOut(sponsorP)
  const stampShown = started && sponsorP > 0.72

  const subscribers = Math.round(d.subscribers * statsP)
  const totalViews = Math.round(d.totalViews * statsP)
  const uploads = Math.round(d.uploads * statsP)
  const rank = Math.round(d.sbRank * 7.4 + (d.sbRank - d.sbRank * 7.4) * statsP)

  const subScores: Array<{ label: string; value: number; tone: Tone }> = [
    { label: 'Influence', value: d.cqs.influence, tone: 'accent' },
    { label: 'Audience', value: d.cqs.audience, tone: 'data5' },
    { label: 'Credibility', value: d.cqs.credibility, tone: 'live' },
    { label: 'Engagement', value: d.cqs.engagement, tone: 'data6' },
  ]
  const scoreValue = Math.round(d.cqs.total * scoreP)

  const compiledSections = ['resolve', 'stats', 'sponsor', 'audience', 'credibility', 'score'].filter((id) => sim.reached(id)).length
  const compiled = sim.reached('compile')

  const dropFor = (index: number) => {
    const order = sponsoredRows.findIndex((r) => r.videoId === creator.uploads[index].videoId)
    if (order < 0) return 0
    const start = 0.22 + order * 0.05
    return clamp((sponsorP - start) / 0.3)
  }

  const droppedRows = creator.uploads.map((row, i) => ({ row, drop: dropFor(i) })).filter(({ row, drop }) => isSponsored(row) && drop > 0)

  return (
    <figure data-slot="sponsorship-split" className="m-0 flex min-w-0 flex-col gap-16">
      <figcaption className="sr-only">
        {`The creator's last ${creator.uploads.length} uploads on one timeline. ${organicCount} organic uploads average ${fmtPct(d.erOrganic)} engagement. ${sponsoredRows.length} paid uploads average ${fmtPct(d.erSponsored)} engagement, a change of ${Math.round(sponsorDelta(d) * 100)} percent. Every figure comes from public channel data as of ${AS_OF}.`}
      </figcaption>

      {/* identity */}
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex min-w-0 items-center gap-12">
          <Avatar name={d.handle} size={40} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-mono text-title font-bold text-ink">
              <span className="truncate">{started ? d.handle.slice(0, handleChars) : d.handle}</span>
              {started && resolveP < 0.96 && <span aria-hidden className="inline-block h-16 w-2 shrink-0 rounded-full bg-accent-ink motion-safe:animate-blink" />}
            </p>
            <p className="truncate font-mono text-micro text-muted" title={apiTitle('channels.list id')}>
              {showId ? d.channelId : started ? 'resolving channel id' : 'public channel data only'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-8">
          {showGrade && <GradeChip grade={d.grade} className="motion-safe:animate-enter" />}
          <Badge tone="muted">Public data</Badge>
        </div>
      </div>

      {/* counters */}
      <div className="grid grid-cols-2 gap-12 sm:grid-cols-4">
        <div title={apiTitle('statistics.subscriberCount')}>
          <div className="text-micro text-muted">Subscribers</div>
          <div className="tabular mt-2 font-mono text-stat font-bold text-ink">
            <NumberTicker value={subscribers} format={fmtCompact} />
          </div>
        </div>
        <div title={apiTitle('statistics.viewCount')}>
          <div className="text-micro text-muted">Total views</div>
          <div className="tabular mt-2 font-mono text-stat font-bold text-ink">
            <NumberTicker value={totalViews} format={fmtCompact} />
          </div>
        </div>
        <div title={apiTitle('statistics.videoCount')}>
          <div className="text-micro text-muted">Uploads</div>
          <div className="tabular mt-2 font-mono text-stat font-bold text-ink">
            <NumberTicker value={uploads} format={fmtInt} />
          </div>
        </div>
        <div title={`Social Blade rank, as of ${AS_OF}`}>
          <div className="text-micro text-muted">Social Blade rank</div>
          <div className="tabular mt-2 font-mono text-stat font-bold text-ink">#{fmtInt(Math.max(d.sbRank, rank))}</div>
        </div>
      </div>

      {/* organic lane */}
      <div className="rounded-8 border border-line bg-sunken p-12">
        <div className="flex flex-wrap items-end justify-between gap-12">
          <div className="min-w-0 flex-1">
            <Meter
              label={`Organic engagement, ${organicCount} uploads`}
              value={organicEr}
              max={GAUGE_MAX}
              tone="live"
              format={(n) => fmtPct(n)}
              ariaLabel="Organic engagement rate against a ten percent scale"
            />
          </div>
          <span className="shrink-0 text-micro text-muted">of the last 48 uploads</span>
        </div>
        <div aria-hidden className={cn(LANE_COLUMNS, 'mt-12')}>
          {creator.uploads.map((row, i) => {
            const sponsored = isSponsored(row)
            const drop = sponsored ? dropFor(i) : 0
            if (sponsored && drop > 0.02) {
              return <div key={row.videoId} className="aspect-video rounded-8 border border-dashed border-line bg-sunken" />
            }
            const arrive = clamp(crawlP * 48 - i)
            if (i >= visibleTiles) return <div key={row.videoId} className="aspect-video rounded-8 border border-line bg-sunken" />
            return (
              <Tile
                key={row.videoId}
                row={row}
                opacity={reduced ? 1 : arrive}
                badges={badgeOpacity}
                paid={sponsored && sponsorP > 0.05}
              />
            )
          })}
        </div>
      </div>

      {/* sponsored lane */}
      <div className="rounded-8 border border-line bg-sunken p-12">
        <div className="flex flex-wrap items-center justify-between gap-12">
          <div className="min-w-0 flex-1">
            <Meter
              label={`Sponsored engagement, ${sponsoredRows.length} uploads`}
              value={sponsorP > 0 ? sponsoredEr : d.erOrganic}
              max={GAUGE_MAX}
              tone="warn"
              format={(n) => fmtPct(n)}
              ariaLabel="Sponsored engagement rate against a ten percent scale"
            />
          </div>
          {stampShown ? (
            <p className="motion-safe:animate-stamp shrink-0 rounded-8 border border-warn bg-warn-soft px-12 py-8 text-label font-bold text-warn">
              {sponsorHeadline(d)}
            </p>
          ) : (
            <span className="shrink-0 text-micro text-muted">Paid placement detected from the API and the description</span>
          )}
        </div>
        {droppedRows.length > 0 ? (
          <div aria-hidden className={cn(LANE_COLUMNS, 'mt-12')}>
            {droppedRows.map(({ row, drop }) => (
              <div key={row.videoId} style={{ transform: reduced ? undefined : `translateY(${(1 - drop) * -12}px)` }}>
                <Tile row={row} opacity={drop} badges={badgeOpacity} paid />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Gauge}
            sentence="No paid upload has been detected in this window yet."
            actionLabel="Skip to results"
            onAction={sim.skip}
            className="mt-8 border border-dashed border-line rounded-8"
          />
        )}
      </div>

      {/* stage read-outs */}
      <div className="grid gap-16 rounded-8 border border-line bg-sunken p-16 md:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-label font-medium text-ink">Audience</h3>
            <ModelledTag />
          </div>
          <div className="mt-8 flex flex-col gap-4">
            {creator.ageBands.slice(0, 2).map((band) => (
              <MiniHatchBar key={band.band} label={band.band} pct={band.pct * audienceP} pending={!sim.reached('audience')} />
            ))}
            {creator.countries.slice(0, 2).map((country) => (
              <MiniHatchBar key={country.code} label={country.name} pct={country.pct * audienceP} pending={!sim.reached('audience')} wide />
            ))}
          </div>
          <p className="mt-8 text-micro text-muted">Age bands and countries are modelled. Country is the finest location kept.</p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-label font-medium text-ink">Credibility</h3>
            <span className="tabular font-mono text-micro text-muted">1,000 dots</span>
          </div>
          <div className="mt-8 flex items-start gap-12">
            <DotField seed={d.handle} credibilityPct={d.credibilityPct} progress={sim.reached('credibility') ? credP : 0} />
            <div className="min-w-0">
              {sim.reached('credibility') ? (
                <>
                  <p className="tabular font-mono text-stat font-bold text-ink">{Math.round(100 - (100 - d.credibilityPct) * credP)}%</p>
                  <p className="text-micro text-muted">read as real</p>
                </>
              ) : (
                <Skeleton className="h-24 w-48" />
              )}
            </div>
          </div>
          <p className="mt-8 text-micro text-muted" title={`statistics.subscriberCount, as of ${AS_OF}`}>
            {!sim.reached('credibility')
              ? 'The scan runs after the audience estimate.'
              : credP > 0.55
                ? `about ${fmtReach(realReach(d))} real of ${fmtReach(d.subscribers)}`
                : `${fmtReach(d.subscribers)} subscribers read`}
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-label font-medium text-ink">Channel Quality Score</h3>
            <span className="tabular font-mono text-micro text-muted">of 100</span>
          </div>
          <div className="mt-8 flex items-center gap-8">
            <svg viewBox="0 0 140 140" role="img" aria-label={sim.reached('score') ? `Channel Quality Score ${scoreValue} of 100` : 'Channel Quality Score, not scored yet'} className="size-96 shrink-0">
              <circle cx="70" cy="70" r="52" fill="none" strokeWidth={8} className="stroke-raised" />
              {subScores.map((s, i) => (
                <path
                  key={s.label}
                  d={arcPath(70, 70, 52, -90 + i * 90 + 8, -90 + (i + 1) * 90 - 8)}
                  fill="none"
                  strokeWidth={8}
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray={`${(s.value * scoreP).toFixed(1)} 100`}
                  className={toneStroke[s.tone]}
                />
              ))}
              {sim.reached('score') && (
                <text x="70" y="70" textAnchor="middle" dominantBaseline="central" className="fill-ink font-mono text-title font-bold">
                  {scoreValue}
                </text>
              )}
            </svg>
            <ul className="flex min-w-0 flex-col gap-2">
              {subScores.map((s) => (
                <li key={s.label} className="flex items-baseline justify-between gap-8 text-micro">
                  <span className="truncate text-muted">{s.label}</span>
                  {sim.reached('score') ? (
                    <span className={cn('tabular font-mono', toneText[s.tone])}>{Math.round(s.value * scoreP)}</span>
                  ) : (
                    <Skeleton className="h-10 w-24" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-label font-medium text-ink">{compiled ? 'Dossier, refreshed weekly' : 'Dossier in progress'}</h3>
            <span className="tabular font-mono text-micro text-muted">{compiledSections}/6</span>
          </div>
          <ProgressBar value={compiledSections / 6} size="sm" label="Dossier sections compiled" className="mt-8" />
          <dl className="mt-8 flex flex-col gap-4 text-micro">
            {sim.reached('resolve') && (
              <div className="flex items-baseline justify-between gap-8">
                <dt className="text-muted">Grade</dt>
                <dd className="font-mono text-ink">{d.grade}</dd>
              </div>
            )}
            {sim.reached('stats') && (
              <div className="flex items-baseline justify-between gap-8">
                <dt className="text-muted">Subscribers</dt>
                <dd className="tabular font-mono text-ink">{fmtReach(d.subscribers)}</dd>
              </div>
            )}
            {sim.reached('sponsor') && (
              <div className="flex items-baseline justify-between gap-8">
                <dt className="text-muted">Sponsored ER</dt>
                <dd className="tabular font-mono text-warn">{fmtPct(d.erSponsored)}</dd>
              </div>
            )}
            {sim.reached('score') && (
              <div className="flex items-baseline justify-between gap-8">
                <dt className="text-muted">CQS</dt>
                <dd className="tabular font-mono text-ink">{d.cqs.total}</dd>
              </div>
            )}
          </dl>
          {compiled ? (
            <Button size="sm" variant="primary" icon={Sparkles} className="mt-12" onClick={() => push({ title: 'Export queued', description: 'This preview stops at the toast. No PDF is generated.', tone: 'ok' })}>
              Export PDF
            </Button>
          ) : (
            <p className="mt-8 text-micro text-muted">Compiles after the score stage.</p>
          )}
        </div>
      </div>

      {/* the policy footer sits inside the stage so no screenshot can lose it */}
      <p className="flex items-start gap-8 rounded-8 border border-line px-12 py-8 text-micro text-muted">
        <Lock aria-hidden className="mt-2 size-12 shrink-0" />
        <span>
          Not collected: home address, phone, family, private data. This run read public channel analytics, the public About page and aggregate audience estimates only.
        </span>
      </p>
      <p className="sr-only">
        {`Stage state: ${started ? sim.stage?.label ?? 'complete' : 'idle'}. ${organicCount} organic uploads and ${sponsoredRows.length} paid uploads in the window.`}
      </p>
      {compileP > 0.99 && <span className="sr-only">Dossier compiled.</span>}
    </figure>
  )
}

/** The 360px aside: the scripted log and the counters the run is reading. */
export function CreatorAside({ sim, creator, game }: { sim: Simulation; creator: Creator; game: Game }) {
  const d = creator.dossier
  const statsP = easeOut(sim.within('stats'))
  const lines = revealed(logLines(creator, game), sim).map((l) => ({
    id: l.id,
    ts: fmtLogTime(l.at),
    level: l.level,
    text: l.text,
  }))

  return (
    <div className="flex flex-col gap-12">
      {lines.length > 0 ? (
        <LogStream lines={lines} title="Daemon log" heightClass="h-240" />
      ) : (
        <div className="rounded-8 border border-line bg-sunken p-12" aria-busy>
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="mt-8 h-10 w-4/5" />
          <Skeleton className="mt-8 h-10 w-2/3" />
          <Skeleton className="mt-8 h-10 w-3/4" />
        </div>
      )}
      <div className="rounded-8 border border-line bg-sunken p-12">
        <h3 className="text-label font-medium text-ink">Live counters</h3>
        <dl className="mt-8 flex flex-col gap-6 text-micro">
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Subscribers</dt>
            <dd className="tabular font-mono text-ink" title={apiTitle('statistics.subscriberCount')}>
              {fmtCompact(Math.round(d.subscribers * statsP))}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Total views</dt>
            <dd className="tabular font-mono text-ink" title={apiTitle('statistics.viewCount')}>
              {fmtCompact(Math.round(d.totalViews * statsP))}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Uploads read</dt>
            <dd className="tabular font-mono text-ink" title={apiTitle('statistics.videoCount')}>
              {Math.round(48 * easeOut(sim.within('crawl')))}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">Paid placements</dt>
            <dd className="tabular font-mono text-warn" title={apiTitle('paidProductPlacementDetails.hasPaidProductPlacement')}>
              {Math.round(creator.uploads.filter(isSponsored).length * easeOut(sim.within('sponsor')))}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">ER organic</dt>
            <dd className="tabular font-mono text-live">{fmtPct(d.erOrganic)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-8">
            <dt className="text-muted">ER sponsored</dt>
            <dd className="tabular font-mono text-warn">{fmtPct(d.erSponsored)}</dd>
          </div>
        </dl>
        <p className="mt-12 text-micro text-muted">Public reads only. No private record is fetched or inferred.</p>
      </div>
    </div>
  )
}
