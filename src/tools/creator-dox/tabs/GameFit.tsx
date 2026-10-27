import { Gamepad2 } from 'lucide-react'
import { BarList, Badge, EmptyState, Metric } from '@/components/ui'
import { fmtInt, fmtPct } from '@/lib/format'
import { apiTitle, Meter } from '../bits'
import { gameName, type Creator } from '../data'
import type { TabProps } from './Overview'

export function GameFit({ creator, game, onNavigate }: TabProps) {
  const d = creator.dossier
  const fit = d.gameFitPct[game.id] ?? 0
  const inGame = Math.round((creator.uploads.length * fit) / 100)
  const mix = Object.entries(d.gameFitPct)
    .filter(([id]) => id !== game.id)
    .sort((a, b) => b[1] - a[1])
  const averageInGame = creator.uploads.filter((u) => u.game === game.shortName)

  if (fit <= 0) {
    return (
      <EmptyState
        icon={Gamepad2}
        sentence="None of their recent uploads feature this game, so there is no fit to score."
        actionLabel="Open the overview tab"
        onAction={() => onNavigate('overview')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-24">
      <div className="grid gap-24 md:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-8">
            <Metric label={`${game.shortName} fit`} value={fmtPct(fit / 100, 0)} size="mega" tone="accent" hint={`${inGame} of the last ${creator.uploads.length} uploads`} />
            <Badge tone="muted">From public titles</Badge>
          </div>
          <p className="mt-12 max-w-prose text-label text-muted">
            {inGame} of their last {creator.uploads.length} uploads already feature {game.shortName}. A creator whose audience already watches the game needs no introduction video, which is the cheapest part of a deal to skip.
          </p>
          <div className="mt-16">
            <Meter label="Share of the upload window" value={fit} max={100} tone="accent" format={(n) => `${Math.round(n)}%`} ariaLabel="Share of uploads featuring the active game" />
          </div>
          <dl className="mt-16 text-label">
            <div className="flex items-baseline justify-between gap-8 border-t border-line py-8">
              <dt className="text-muted">Average views on {game.shortName} uploads</dt>
              <dd className="tabular font-mono text-ink" title={apiTitle('statistics.viewCount')}>
                {averageInGame.length ? `${Math.round(averageInGame.reduce((a, u) => a + u.viewCount, 0) / averageInGame.length / 1000)}K` : 'no sample'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-8 border-t border-line py-8">
              <dt className="text-muted">Average views on every upload</dt>
              <dd className="tabular font-mono text-ink" title={apiTitle('statistics.viewCount')}>
                {Math.round(d.avgViews / 1000)}K
              </dd>
            </div>
          </dl>
        </div>

        <div className="min-w-0">
          <h3 className="text-title font-bold text-ink">What else they cover</h3>
          <p className="mt-4 text-label text-muted">The rest of the upload window, by game. Titles are matched against the Do Big catalogue.</p>
          <BarList
            className="mt-12"
            max={100}
            format={(n) => `${Math.round(n)}%`}
            items={mix.map(([id, pct]) => ({ key: id, label: gameName(id), value: pct, tone: 'muted' as const }))}
          />
        </div>
      </div>

      <div className="rounded-8 border border-line bg-raised p-16">
        <div className="flex flex-wrap items-center justify-between gap-8">
          <h3 className="text-title font-bold text-ink">Brief this creator</h3>
          <Badge tone="accent">{inGame} matching uploads</Badge>
        </div>
        <ul className="mt-8 flex list-disc flex-col gap-4 pl-16 text-label text-muted">
          <li>Lead with the {game.noun}: their {game.shortName} uploads are the format their audience already opens.</li>
          <li>Match the length of their median {game.noun} video, the format that holds {fmtInt(Math.round(d.avgViews / 1000))}K views on average.</li>
          <li>Pair the placement with a second, unsponsored {game.noun} video so the organic lane keeps feeding the paid one.</li>
        </ul>
      </div>
    </div>
  )
}
