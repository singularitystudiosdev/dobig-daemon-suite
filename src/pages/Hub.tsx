import { useMemo } from 'react'
import { fmtCompact, fmtInt, fmtPct, fmtSignedPct, timeAgo } from '@/lib/format'
import { useLiveNumber } from '@/lib/hooks'
import { createRng } from '@/lib/random'
import { daemonHref } from '@/lib/router'
import { cn } from '@/lib/cn'
import { toneBg } from '@/lib/tone'
import { busFor, type BusSeverity } from '@/data/bus'
import { daemons, daemonsBySlug, type DaemonMeta, type DaemonStat } from '@/data/daemons'
import { games, gamesById, portfolio, type Game } from '@/data/games'
import { useActiveGame } from '@/context/ActiveGame'
import { Badge, GameThumb, LiveDot, NumberTicker, StatPill, useToast } from '@/components/ui'

/* The hub, laid out like https://dobig.com/games: title and lede, a grid of square-art cards with
   a green live pill and a white total pill, then the portfolio band. Below it the bus history and
   the guarded games list. */
export default function Hub() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 pb-96 pt-40">
      <div className="md:px-32">
        <h1 className="text-display text-ink">Our Daemons</h1>
        <p className="mt-8 max-w-prose text-stat text-muted">Six autonomous tools that grow and guard every live operated Do Big game. Pick one to watch it run.</p>
      </div>

      <ul className="mt-32 grid grid-cols-2 gap-12 sm:gap-16 md:grid-cols-3 md:gap-24 xl:grid-cols-6">
        {daemons.map((d) => (
          <DaemonCard key={d.slug} daemon={d} />
        ))}
      </ul>

      <PortfolioBand />

      <div className="mt-24 grid gap-24 lg:grid-cols-5">
        <BusHistory className="lg:col-span-3" />
        <GuardedGames className="lg:col-span-2" />
      </div>
    </main>
  )
}

function formatStat(stat: DaemonStat, value: number) {
  if (stat.format === 'compact') return fmtCompact(value)
  if (stat.format === 'pct') return fmtPct(value)
  if (stat.format === 'signed-pct') return fmtSignedPct(value)
  return fmtInt(value)
}

function DaemonCard({ daemon }: { daemon: DaemonMeta }) {
  const live = useLiveNumber(daemon.primary.value, { spread: daemon.primary.value > 10000 ? 0.0015 : 0.01, seed: daemon.slug, every: 2200 })
  const primaryValue = daemon.primary.live ? live : daemon.primary.value
  return (
    <li>
      <a
        href={daemonHref(daemon.slug)}
        className="state-layer group flex h-full flex-col rounded-20 border border-line bg-surface p-12 transition-transform duration-200 ease-standard hover:-translate-y-8 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-16"
      >
        <div className="overflow-hidden rounded-8">
          <img
            src={daemon.thumb}
            alt={`${daemon.name} art`}
            width={512}
            height={512}
            decoding="async"
            className="aspect-square w-full bg-raised object-cover transition-transform duration-200 ease-standard group-hover:scale-102 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </div>
        <h2 className="mt-12 line-clamp-2 min-h-52 text-center text-title font-bold text-ink transition-colors duration-150 group-hover:text-accent-ink">{daemon.name}</h2>
        <div className="mt-auto flex flex-col gap-4 pt-8">
          <StatPill label={daemon.primary.label} value={<NumberTicker value={primaryValue} format={(n) => formatStat(daemon.primary, n)} />} tone="live" />
          <StatPill label={daemon.secondary.label} value={formatStat(daemon.secondary, daemon.secondary.value)} />
        </div>
      </a>
    </li>
  )
}

function PortfolioBand() {
  const playing = useLiveNumber(portfolio.playing, { spread: 0.0008, seed: 'portfolio', every: 1600 })
  const stats: { label: string; value: string; hint: string }[] = [
    { label: 'Plays', value: fmtCompact(portfolio.visits), hint: 'Lifetime visits across the 12 games shown' },
    { label: 'Takedown links filed', value: '412', hint: 'This week, 361 approved so far' },
    { label: 'Exploit clusters', value: '38', hint: '4 critical, 11 patched this week' },
    { label: 'People heard', value: '18,420', hint: 'Unique Discord voices, staff and raids excluded' },
    { label: 'Copy tests kept', value: '9 of 14', hint: 'Median +0.33pp play-through rate' },
    { label: 'Creator dossiers', value: '312', hint: 'Refreshed weekly from public channel data' },
  ]
  return (
    <section aria-labelledby="portfolio-title" className="mt-48 rounded-20 border border-line bg-surface px-24 py-32 md:px-32">
      <div className="flex flex-wrap items-end justify-between gap-24">
        <div>
          <h2 id="portfolio-title" className="text-headline text-ink">
            Across your entire portfolio
          </h2>
          <p className="mt-4 text-label text-muted">{fmtInt(portfolio.totalGames)} games under daemon watch, 12 shown here</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-12">
            <LiveDot />
            <NumberTicker value={playing} className="text-mega text-live" />
          </div>
          <p className="mt-4 text-stat text-muted">playing right now</p>
        </div>
      </div>
      <dl className="mt-32 grid grid-cols-2 gap-24 border-t border-line pt-24 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="text-label text-muted">{s.label}</dt>
            <dd className="tabular mt-4 text-headline text-ink">{s.value}</dd>
            <dd className="mt-4 text-micro text-subtle">{s.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const severityTone: Record<BusSeverity, 'accent' | 'live' | 'warn' | 'danger'> = { info: 'accent', ok: 'live', warn: 'warn', danger: 'danger' }
const severityLabel: Record<BusSeverity, string> = { info: 'Info', ok: 'Done', warn: 'Watch', danger: 'Act now' }

/* The confounder bus across the portfolio, newest first. */
function BusHistory({ className }: { className?: string }) {
  const rows = useMemo(
    () =>
      games
        .slice(0, 9)
        .map((g, i) => busFor(g)[i])
        .sort((a, b) => b.at.localeCompare(a.at)),
    [],
  )
  return (
    <section aria-labelledby="bus-title" className={cn('min-w-0 rounded-20 border border-line bg-surface', className)}>
      <header className="flex items-center justify-between gap-12 px-24 pt-24">
        <div>
          <h2 id="bus-title" className="text-title font-bold text-ink">
            Confounder bus
          </h2>
          <p className="mt-4 text-label text-muted">Every daemon writes here, and every daemon reads what the others saw.</p>
        </div>
        <Badge tone="live" dot>
          Live
        </Badge>
      </header>
      <ul className="mt-16 px-24 pb-16">
        {rows.map((e) => {
          const meta = daemonsBySlug[e.daemon]
          const game = gamesById[e.gameId]
          return (
            <li key={e.id} className="border-b border-line last:border-b-0">
              <a href={daemonHref(e.daemon, e.focus ? { focus: e.focus } : undefined)} className="state-layer -mx-8 flex items-start gap-12 rounded-8 px-8 py-12">
                <img src={meta.thumb} alt="" width={40} height={40} className="size-40 shrink-0 rounded-8" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-8">
                    <span className="text-label font-medium text-ink">{e.title}</span>
                    <span className="text-micro text-muted">{game.shortName}</span>
                  </div>
                  <p className="mt-2 line-clamp-1 text-label text-muted">{e.detail}</p>
                  <p className="mt-2 flex items-center gap-6 text-micro text-subtle">
                    <span aria-hidden className={cn('size-6 rounded-full', toneBg[meta.tone])} />
                    {meta.name}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-6">
                  <span className="text-micro text-muted">{timeAgo(e.at)}</span>
                  <Badge tone={severityTone[e.severity]}>{severityLabel[e.severity]}</Badge>
                </div>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* Which daemons cover which games. Picking a row attaches every daemon to that game. */
function GuardedGames({ className }: { className?: string }) {
  const { game: active, setGameId } = useActiveGame()
  const { push } = useToast()
  const coverage = useMemo(() => {
    const map: Record<string, boolean[]> = {}
    for (const g of games) {
      const rng = createRng('coverage-' + g.id)
      map[g.id] = daemons.map((_, i) => g.id === 'steal-an-egg' || i === 4 || rng.chance(0.82))
    }
    return map
  }, [])
  const pick = (g: Game) => {
    setGameId(g.id)
    push({ title: `Daemons attached to ${g.shortName}`, description: 'Every daemon page now runs on this game.', tone: 'ok' })
  }
  return (
    <section aria-labelledby="games-title" className={cn('min-w-0 rounded-20 border border-line bg-surface', className)}>
      <header className="px-24 pt-24">
        <h2 id="games-title" className="text-title font-bold text-ink">
          Guarded games
        </h2>
        <p className="mt-4 text-label text-muted">Pick a game to attach every daemon to it.</p>
      </header>
      <ul className="mt-16 px-24 pb-16">
        {games.map((g) => {
          const isActive = g.id === active.id
          return (
            <li key={g.id} className="border-b border-line last:border-b-0">
              <button type="button" onClick={() => pick(g)} aria-pressed={isActive} className="state-layer -mx-8 flex w-full items-center gap-12 rounded-8 px-8 py-8 text-left">
                <GameThumb game={g} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label font-medium text-ink">{g.name}</p>
                  <p className="text-micro text-muted">
                    <span className="tabular font-bold text-live">{fmtInt(g.playing)}</span> playing, {fmtCompact(g.visits)} plays
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-4" aria-label={`${coverage[g.id].filter(Boolean).length} of 6 daemons attached`}>
                  {daemons.map((d, i) => (
                    <span key={d.slug} title={`${d.name}: ${coverage[g.id][i] ? 'attached' : 'not attached'}`} className={cn('size-8 rounded-full', coverage[g.id][i] ? toneBg[d.tone] : 'bg-line-strong')} />
                  ))}
                </span>
                {isActive && <Badge tone="accent">Active</Badge>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
