import { useMemo } from 'react'
import { Sparkline } from '@/components/ui'
import { Metric } from '@/components/ui'
import { fmtCompact, fmtInt, fmtPct, fmtPp, fmtSignedPct } from '@/lib/format'
import { apiTitle, DeltaValue, Meter } from '../bits'
import { sponsorDelta, uploadEr, type Creator } from '../data'
import type { TabProps } from './Overview'

export function Engagement({ creator }: TabProps) {
  const d = creator.dossier
  const delta = sponsorDelta(d)
  const averages = useMemo(() => {
    const n = creator.uploads.length || 1
    const views = creator.uploads.reduce((a, u) => a + u.viewCount, 0) / n
    const likes = creator.uploads.reduce((a, u) => a + u.likeCount, 0) / n
    const comments = creator.uploads.reduce((a, u) => a + u.commentCount, 0) / n
    const organic = creator.uploads.filter((u) => uploadEr(u) > 0 && !u.brandHandle)
    const organicEr = organic.length ? organic.reduce((a, u) => a + uploadEr(u), 0) / organic.length : d.erOrganic
    const sponsored = creator.uploads.filter((u) => !!u.brandHandle)
    const sponsoredEr = sponsored.length ? sponsored.reduce((a, u) => a + uploadEr(u), 0) / sponsored.length : d.erSponsored
    return { views, likes, comments, organicEr, sponsoredEr, organicCount: organic.length, sponsoredCount: sponsored.length }
  }, [creator.uploads, d.erOrganic, d.erSponsored])

  const growth = creator.growth90
  const first = growth[0]
  const last = growth[growth.length - 1]
  const growthPct = first > 0 ? (last - first) / first : 0

  return (
    <div className="flex flex-col gap-24">
      <div className="grid grid-cols-2 gap-16 md:grid-cols-4">
        <div title={apiTitle('statistics.viewCount')}>
          <Metric label="Average views" value={fmtCompact(d.avgViews)} hint={`${fmtInt(Math.round(averages.views))} across the last 48`} />
        </div>
        <div title={apiTitle('statistics.likeCount')}>
          <Metric label="Average likes" value={fmtCompact(averages.likes)} hint="per upload" />
        </div>
        <div title={apiTitle('statistics.commentCount')}>
          <Metric label="Average comments" value={fmtCompact(averages.comments)} hint="per upload" />
        </div>
        <div title={`(statistics.likeCount + statistics.commentCount) / statistics.viewCount, as of 2026-10-26`}>
          <Metric label="Organic ER" value={fmtPct(d.erOrganic)} hint="likes plus comments per view" tone="live" />
        </div>
      </div>

      <div className="grid gap-24 md:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-title font-bold text-ink">Engagement, organic against sponsored</h3>
          <p className="mt-4 max-w-prose text-label text-muted">
            Every upload is scored on public counters. A sponsored upload is one with a paid-placement flag or a brand named in the description.
          </p>
          <div className="mt-16 flex flex-col gap-16">
            <Meter
              label={`Organic, ${averages.organicCount} uploads`}
              value={averages.organicEr}
              max={0.1}
              tone="live"
              format={(n) => fmtPct(n)}
              ariaLabel="Organic engagement rate"
            />
            <Meter
              label={`Sponsored, ${averages.sponsoredCount} uploads`}
              value={averages.sponsoredEr}
              max={0.1}
              tone="warn"
              format={(n) => fmtPct(n)}
              ariaLabel="Sponsored engagement rate"
            />
          </div>
          <p className="mt-16 text-label text-ink">
            Sponsored uploads land {fmtPp((d.erSponsored - d.erOrganic) * 100)} against organic, a <DeltaValue delta={delta} /> change.
          </p>
          <p className="mt-4 text-micro text-muted">
            With {averages.sponsoredCount} paid uploads in the window, that gap is {averages.sponsoredCount < 3 ? 'too thin to price a deal on' : 'stable enough to price a deal on'}.
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-8">
            <h3 className="text-title font-bold text-ink">Views per upload, 90 days</h3>
            <span className="tabular font-mono text-micro text-muted">
              {fmtCompact(first)} to {fmtCompact(last)}
            </span>
          </div>
          <Sparkline data={growth} tone={growthPct >= 0 ? 'live' : 'danger'} width={520} height={96} fill label="Views per upload over the last 90 days" className="mt-12 w-full" />
          <p className="mt-12 max-w-prose text-label text-muted">
            Views per upload moved from {fmtCompact(first)} to {fmtCompact(last)} over 90 days, a {fmtSignedPct(growthPct, 0)} change. A flat line beside a widening engagement gap is the warning sign: reach holds while the audience stops responding.
          </p>
          <p className="mt-8 text-micro text-muted">Daily average views from public view counts, rounded. A trend, not a forecast.</p>
        </div>
      </div>
    </div>
  )
}
