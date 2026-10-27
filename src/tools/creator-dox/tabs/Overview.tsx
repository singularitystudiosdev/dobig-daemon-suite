import { Badge, BarList, KeyValue, Metric } from '@/components/ui'
import { fmtCompact, fmtDayTime, fmtInt, fmtPct, fmtUsdRange } from '@/lib/format'
import { Avatar } from '@/components/ui'
import type { Game } from '@/data/games'
import { apiTitle, GradeChip, ModelledTag } from '../bits'
import { AS_OF, fmtReach, summaryLine, type Creator } from '../data'

export interface TabProps {
  creator: Creator
  game: Game
  /** Jump to another dossier tab, used by empty states and the outreach CTA. */
  onNavigate: (tab: string) => void
}

export function Overview({ creator, game }: TabProps) {
  const d = creator.dossier
  const realShare = d.credibilityPct

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap items-center justify-between gap-16">
        <div className="flex min-w-0 items-center gap-12">
          <Avatar name={d.handle} size={48} />
          <div className="min-w-0">
            <p className="truncate font-mono text-title font-bold text-ink">{d.handle}</p>
            <p className="truncate font-mono text-micro text-muted">{d.channelId}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-8">
          <GradeChip grade={d.grade} />
          <Badge tone="data6">Creator dossier</Badge>
        </div>
      </div>

      <p className="max-w-prose text-label text-muted">
        {summaryLine(creator, game)} {d.grade === 'A' || d.grade === 'A+' || d.grade === 'A++' ? 'A safe partner for a paid placement in this game.' : 'Vet the format before committing budget.'}
      </p>

      <div className="grid grid-cols-2 gap-16 border-y border-line py-16 md:grid-cols-4">
        <div title={apiTitle('statistics.subscriberCount')}>
          <Metric label="Subscribers" value={fmtReach(d.subscribers)} hint={`as of ${AS_OF}`} />
        </div>
        <div title={apiTitle('statistics.viewCount')}>
          <Metric label="Total views" value={fmtCompact(d.totalViews)} hint={`as of ${AS_OF}`} />
        </div>
        <div title={apiTitle('statistics.videoCount')}>
          <Metric label="Uploads" value={fmtInt(d.uploads)} hint="all time, public" />
        </div>
        <div title={`Social Blade rank, as of ${AS_OF}`}>
          <Metric label="Social Blade rank" value={`#${fmtInt(d.sbRank)}`} hint="all categories" />
        </div>
      </div>

      <div className="grid gap-24 md:grid-cols-2">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-title font-bold text-ink">Channel quality</h3>
            <Badge tone={d.cqs.total >= 74 ? 'live' : d.cqs.total >= 66 ? 'accent' : 'warn'}>{fmtInt(d.cqs.total)} of 100</Badge>
          </div>
          <p className="mt-4 max-w-prose text-label text-muted">
            CQS blends reach, real audience, credibility and engagement. It is a ranking aid, not a promise of performance.
          </p>
          <BarList
            className="mt-16"
            max={100}
            format={(n) => `${fmtInt(n)}`}
            items={[
              { key: 'influence', label: 'Influence', value: d.cqs.influence, tone: 'accent', hint: 'Reach against creators of the same size.' },
              { key: 'audience', label: 'Audience', value: d.cqs.audience, tone: 'data5', hint: 'Modelled audience spread and loyalty.' },
              { key: 'credibility', label: 'Credibility', value: d.cqs.credibility, tone: 'live', hint: `${realShare}% of subscribers read as real.` },
              { key: 'engagement', label: 'Engagement', value: d.cqs.engagement, tone: 'data6', hint: 'Likes and comments per view.' },
            ]}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          <div className="rounded-8 border border-line bg-raised p-16" title={`Modelled from statistics.viewCount, as of ${AS_OF}`}>
            <div className="flex items-center justify-between gap-8">
              <h3 className="text-title font-bold text-ink">Estimated earnings</h3>
              <ModelledTag />
            </div>
            <p className="tabular mt-8 text-headline text-ink">{fmtUsdRange(d.earningsRangeUsd[0], d.earningsRangeUsd[1])}</p>
            <p className="text-label text-muted">per month, a range only</p>
            <p className="mt-8 text-micro text-muted">
              Creator revenue is not public. The range prices {fmtCompact(d.avgViews * 4)} monthly views at $0.6 to $9 per thousand views. It is never shown as a single figure.
            </p>
          </div>
          <dl>
            <KeyValue label="Refreshed" value={fmtDayTime(d.refreshedAt)} />
            <KeyValue label="Stats refresh" value="Weekly" />
            <KeyValue label="Audience refresh" value="Monthly" />
            <KeyValue label="Organic ER" value={fmtPct(d.erOrganic)} />
            <KeyValue label="Sponsored ER" value={fmtPct(d.erSponsored)} />
            <KeyValue label="Game fit" value={`${d.gameFitPct[game.id] ?? 0}% ${game.shortName}`} />
          </dl>
        </div>
      </div>
    </div>
  )
}
