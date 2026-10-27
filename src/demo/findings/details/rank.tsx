import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge, KeyValue, Sparkline, Table, Td, Th } from '@/components/ui'
import { PHRASE_SOURCE_LABEL, RANK_DEPTH, type RankDetail, type RankNeighbor, type RankStatus } from '@/lib/details/rank'
import { fmtCompact, fmtInt, fmtPct } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { AutomateCta } from '@/demo/shell/AutomateCta'
import type { DetailViewProps } from './types'

/* Rank Daemon detail for one search phrase: where the game stood now and last run, the ten games around it, who passed
   it, a small position history, and when and how deep the search was read. Positions count regular results only. */

const SPARK_TONE: Record<RankStatus, Tone> = { lost: 'danger', dropped: 'warn', climbed: 'live', new: 'accent', first: 'muted', steady: 'muted', absent: 'muted' }

const linkClass = 'rounded-8 text-accent-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent-ink'

const posText = (p: number | null) => (p === null ? `Not in the first ${RANK_DEPTH}` : `${p}`)
const short = (p: number | null) => (p === null ? `${RANK_DEPTH}+` : String(p))

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** One plain sentence on where the game stands and what changed. */
function headline(d: RankDetail): string {
  const here = d.position === null ? `Your game is not in the first ${RANK_DEPTH} results for this phrase.` : `Your game is position ${d.position} for this phrase.`
  switch (d.status) {
    case 'first':
      return `${here} First read: there is nothing earlier to compare with, so the next run will show what moved.`
    case 'steady':
      return `${here} It was position ${d.previous} last run, so it has not moved.`
    case 'climbed':
      return `${here} It was position ${d.previous} last run, so it climbed ${d.change}.`
    case 'dropped':
      return `${here} It was position ${d.previous} last run, so it dropped ${Math.abs(d.change ?? 0)}.`
    case 'lost':
      return `${here} It was position ${d.previous} last run.`
    case 'new':
      return `${here} ${d.everFound ? 'It was missing last run, so it is back.' : 'It was not found in earlier runs, so this is the first time it shows.'}`
    default:
      return `${here} It was not found last run either.`
  }
}

function Block({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h3 className="text-label font-medium text-muted">{label}</h3>
        {hint && <p className="max-w-prose text-micro text-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function GameLink({ n }: { n: RankNeighbor }) {
  return (
    <a href={n.url} target="_blank" rel="noreferrer" className={linkClass}>
      {n.name}
      <ExternalLink aria-hidden className="ml-4 inline size-12 align-baseline" />
    </a>
  )
}

export default function RankDetailView({ detail: d }: DetailViewProps<RankDetail>) {
  const spark = d.history.map((h) => RANK_DEPTH + 1 - (h.position ?? RANK_DEPTH + 1))
  const sparkLabel = `Position history, oldest to newest: ${d.history.map((h) => short(h.position)).join(', ')}. A higher line is a better position.`
  return (
    <div className="flex flex-col gap-24">
      <p className="max-w-prose text-label text-ink">{headline(d)}</p>

      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <Block label="This phrase">
          <dl>
            <KeyValue label="Searched as" value={<span className="tabular">{d.phrase}</span>} />
            <KeyValue label="Where it came from" value={<span className="whitespace-normal">{PHRASE_SOURCE_LABEL[d.source]}</span>} />
            <KeyValue label="Position now" value={<span className="tabular">{posText(d.position)}</span>} />
            <KeyValue label="Position last run" value={<span className="tabular">{d.hadPrevious ? posText(d.previous) : 'No earlier read'}</span>} />
            <KeyValue label="Results read" value={<span className="tabular">{`${fmtInt(d.scanned)} games in ${d.pages} ${d.pages === 1 ? 'page' : 'pages'}`}</span>} />
            <KeyValue label="Ads set aside" value={<span className="tabular">{d.adsSeen}</span>} />
            <KeyValue label="Searched at" value={<span className="tabular">{when(d.fetchedAt)}</span>} />
          </dl>
        </Block>

        <Block label="Position history" hint="Up is better. Each number is the position at one run, oldest first.">
          {d.history.length < 2 ? (
            <p className="text-label text-muted">First read, so there is no history yet. It builds up with every run, up to the last 10.</p>
          ) : (
            <div className="flex flex-col gap-12">
              <Sparkline data={spark} tone={SPARK_TONE[d.status]} width={240} height={48} label={sparkLabel} className="w-full max-w-240" />
              <ol className="flex flex-wrap gap-x-16 gap-y-8">
                {d.history.map((h, i) => (
                  <li key={h.at + i} className="flex min-w-48 flex-col">
                    <span className="tabular text-label text-ink">{short(h.position)}</span>
                    <span className="text-micro text-subtle">{day(h.at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Block>
      </div>

      <Block
        label={d.aroundKind === 'around' ? 'The games around you' : `Who holds the top of this search`}
        hint={d.aroundKind === 'top' ? `Your game is not in the first ${RANK_DEPTH}, so these are the leading results instead.` : 'Five above and five below your game, in the order Roblox listed them. Ads are shown where they sat and are not counted.'}
      >
        <Table caption={`Games around ${d.gameName} in the search for ${d.phrase}`}>
          <thead>
            <tr>
              <Th numeric>Position</Th>
              <Th>Game</Th>
              <Th numeric>Players now</Th>
              <Th numeric>Like ratio</Th>
            </tr>
          </thead>
          <tbody>
            {d.around.map((n) => {
              const mine = !n.sponsored && n.position !== null && n.position === d.position
              return (
                <tr key={n.universeId} className={mine ? 'bg-accent-soft' : undefined}>
                  <Td numeric className="w-72 whitespace-nowrap">
                    {n.sponsored ? <span className="text-muted">Ad</span> : n.position}
                  </Td>
                  <Td className="min-w-200 whitespace-normal">
                    <span className="flex flex-wrap items-center gap-x-8 gap-y-4">
                      <GameLink n={n} />
                      {mine && <Badge tone="accent">Your game</Badge>}
                      {n.sponsored && <Badge tone="muted">Sponsored, not counted</Badge>}
                    </span>
                  </Td>
                  <Td numeric className="whitespace-nowrap" title={fmtInt(n.playing)}>
                    {fmtCompact(n.playing)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {n.likeRatio === null ? 'No votes' : fmtPct(n.likeRatio, 0)}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Block>

      <Block label="Who passed you" hint="Games that were below yours last run and are above it now.">
        {!d.passedKnown ? (
          <p className="max-w-prose text-label text-muted">
            {d.position === null ? 'Not shown while your game is out of the results.' : d.hadPrevious ? 'The order from the last run is not known for this phrase, so who passed you cannot be told.' : 'First read, so there is no earlier order to compare with.'}
          </p>
        ) : d.passed.length === 0 ? (
          <p className="max-w-prose text-label text-muted">Nobody passed you since the last run.</p>
        ) : (
          <ul className="flex flex-col">
            {d.passed.map((p) => (
              <li key={p.placeId} className="flex flex-wrap items-baseline justify-between gap-x-16 gap-y-2 border-b border-line py-8 last:border-b-0">
                <GameLink n={{ ...p, universeId: p.placeId, likeRatio: null, sponsored: false, position: p.now }} />
                <span className="tabular text-micro text-muted">{`Was ${p.was}, now ${p.now}, ${fmtCompact(p.playing)} playing`}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <div className="flex flex-wrap items-center gap-x-16 gap-y-8 border-t border-line pt-12">
        <a href={d.searchUrl} target="_blank" rel="noreferrer" className={`${linkClass} inline-flex items-center gap-6 text-label`}>
          <ExternalLink aria-hidden className="size-12 shrink-0" />
          See this search on roblox.com
        </a>
        <span className="max-w-prose text-micro text-subtle">Roblox may order results differently for a signed-in player, so what you see there can differ from this read.</span>
      </div>

      <AutomateCta slug="rank-daemon" game={d.gameName} variant="line" />
    </div>
  )
}
