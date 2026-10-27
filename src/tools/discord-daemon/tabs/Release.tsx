import { CalendarCheck, CircleCheck, CircleDashed, PackageCheck } from 'lucide-react'
import { fmtDay, fmtDayTime, fmtInt, fmtPct } from '@/lib/format'
import { Badge, EmptyState, KeyValue } from '@/components/ui'
import { quotesFor, type DiscordDataset } from '../data'
import { TextEquivalent, Unavailable } from '../parts'

/* Day 7 release report: what shipped, what the server made of it, and what is still open.
   Volume is real metadata; sentiment is labelled unavailable when MESSAGE_CONTENT is missing. */

export function ReleaseTab({ dataset, onOpenQuotes }: { dataset: DiscordDataset; onOpenQuotes: (topicId: string | null, title: string, total: number) => void }) {
  const release = dataset.release
  const peak = Math.max(...release.series.map((d) => d.messages))
  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-wrap items-end justify-between gap-16">
        <div>
          <h3 className="text-title font-bold text-ink">{release.label} report</h3>
          <div className="mt-4 flex flex-wrap items-center gap-8 text-micro text-muted">
            <CalendarCheck aria-hidden className="size-14" />
            Day {release.day}, shipped {fmtDay(release.shippedOn + 'T12:00:00')}
          </div>
          <p className="mt-4 max-w-prose text-label text-muted">{release.summary}</p>
        </div>
        <Badge tone={dataset.metadataOnly ? 'warn' : 'live'} dot pulse={false}>
          {dataset.metadataOnly ? 'Volume only, sentiment unavailable' : 'Sentiment recovered to +0.08'}
        </Badge>
      </div>

      <dl className="grid gap-x-24 sm:grid-cols-3">
        <KeyValue label="Messages this week" value={fmtInt(dataset.window.messages)} />
        <KeyValue label="People counted today" value={fmtInt(dataset.window.people)} />
        <KeyValue label="Negative share today" value={dataset.metadataOnly ? <Unavailable label="No content" /> : fmtPct(dataset.window.negativePeopleShare, 0)} />
      </dl>

      <section>
        <h4 className="text-label font-medium text-ink">Volume and sentiment by day</h4>
        <ul className="mt-8 flex flex-col gap-6">
          {release.series.map((day) => (
            <li key={day.day} className="flex items-center gap-12">
              <span className="tabular w-48 shrink-0 font-mono text-micro text-muted">{day.day}</span>
              <span className="flex min-w-0 flex-1 items-center gap-8">
                <span className="h-8 flex-1 overflow-hidden rounded-full bg-raised">
                  <span className="block h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${day.messages / peak})` }} />
                </span>
                <span className="tabular w-56 shrink-0 text-right font-mono text-micro text-ink">{fmtInt(day.messages)}</span>
              </span>
              <span className="w-64 shrink-0 text-right">
                {day.sentiment === null ? <Unavailable label="No content" /> : <span className={`tabular font-mono text-micro ${day.sentiment < 0 ? 'text-danger' : 'text-live'}`}>{day.sentiment > 0 ? '+' : ''}{day.sentiment.toFixed(2)}</span>}
              </span>
            </li>
          ))}
        </ul>
        <TextEquivalent>
          Peak day {release.series.reduce((a, b) => (b.messages > a.messages ? b : a)).day} at {fmtInt(peak)} messages. {dataset.metadataOnly ? 'Sentiment is unavailable without message content.' : 'Sentiment bottomed on Oct 23 at -0.12 and recovered to +0.08 by Oct 26.'}
        </TextEquivalent>
      </section>

      <div className="grid gap-24 md:grid-cols-2">
        <section>
          <h4 className="flex items-center gap-8 text-label font-medium text-ink">
            <PackageCheck aria-hidden className="size-14 text-muted" />
            Shipped
          </h4>
          <ul className="mt-8 flex flex-col">
            {release.shipped.map((item) => (
              <li key={item} className="flex items-start justify-between gap-8 border-b border-line py-8 last:border-b-0">
                <span className="flex min-w-0 items-start gap-8 text-micro text-muted">
                  <CircleCheck aria-hidden className="mt-2 size-12 shrink-0 text-live" />
                  <span>
                    <span className="block text-label text-ink">{item}</span>
                    <span className="text-micro text-subtle">Shipped {fmtDay(release.shippedOn + 'T12:00:00')}</span>
                  </span>
                </span>
                <Badge tone="live">Shipped</Badge>
              </li>
            ))}
          </ul>
          <h4 className="mt-16 flex items-center gap-8 text-label font-medium text-ink">
            <CircleCheck aria-hidden className="size-14 text-live" />
            Resolved
          </h4>
          <ul className="mt-8 flex flex-col">
            {release.resolved.map((item) => (
              <li key={item} className="flex items-start justify-between gap-8 border-b border-line py-8 last:border-b-0">
                <span className="min-w-0">
                  <span className="block text-label text-ink">{item}</span>
                  <span className="text-micro text-subtle">Closed {fmtDay('2026-10-24T12:00:00')}</span>
                </span>
                <Badge tone="accent">Resolved</Badge>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className="flex items-center gap-8 text-label font-medium text-ink">
            <CircleDashed aria-hidden className="size-14 text-warn" />
            Still open
          </h4>
          {release.open.length === 0 ? (
            <EmptyState icon={CircleDashed} sentence="Nothing is open from this release, so the report has no follow-up to assign." actionLabel="Open the topic table" onAction={() => onOpenQuotes(null, 'All linked messages', 24)} />
          ) : (
            <ul className="mt-8 flex flex-col">
              {release.open.map((item, i) => (
                <li key={item} className="flex items-start justify-between gap-8 border-b border-line py-8 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block text-label text-ink">{item}</span>
                    <span className="text-micro text-subtle">Open since {fmtDay(i % 2 === 0 ? '2026-10-23T12:00:00' : '2026-10-25T12:00:00')}</span>
                  </span>
                  <Badge tone="warn">Open</Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-16 rounded-8 border border-line px-12 py-8">
            <p className="text-micro text-muted">Verdict</p>
            <p className="mt-4 text-label text-ink">{release.verdict}</p>
            <button
              type="button"
              onClick={() => onOpenQuotes(dataset.topics[0].id, `${release.label}, source messages`, dataset.topics[0].messages)}
              className="mt-8 text-micro text-accent-ink transition-colors duration-150 hover:text-ink"
            >
              Open the kept quotes behind the report
            </button>
          </div>
        </section>
      </div>

      <p className="text-micro text-subtle">Report generated {fmtDayTime(dataset.window.end)} from {fmtInt(dataset.window.messages)} messages. Server data stays local to the demo.</p>
    </div>
  )
}
