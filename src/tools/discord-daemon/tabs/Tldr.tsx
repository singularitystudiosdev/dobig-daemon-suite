import { Lightbulb, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDay, fmtInt, fmtPct } from '@/lib/format'
import { toneBg, type Tone } from '@/lib/tone'
import { Badge, Button, EmptyState, KeyValue } from '@/components/ui'
import { severityTone, type DiscordDataset } from '../data'
import { TrendBadge } from '../parts'

/* TL;DR: the nightly summary and the six insights, each one linked to the messages that
   produced it. Severity is a status token, never decoration. */

export function TldrTab({ dataset, onOpenQuotes }: { dataset: DiscordDataset; onOpenQuotes: (topicId: string | null, title: string, total: number) => void }) {
  const insights = dataset.insights
  const negative = dataset.metadataOnly ? 'No content' : fmtPct(dataset.window.negativePeopleShare, 0)
  return (
    <div className="flex flex-col gap-24">
      <section className="rounded-8 border border-line bg-raised p-16">
        <div className="flex flex-wrap items-start justify-between gap-16">
          <div className="min-w-0">
            <h3 className="text-title font-bold text-ink">Nightly summary for {fmtDay(dataset.window.end)}</h3>
            <p className="mt-8 max-w-prose text-label text-muted">
              {dataset.metadataOnly
                ? `${fmtInt(dataset.window.messages)} messages from ${fmtInt(dataset.window.accounts)} accounts in ${dataset.server.name}. MESSAGE_CONTENT is not approved, so this read counts who posted, where and when, and leaves sentiment out.`
                : `${fmtInt(dataset.window.messages)} messages from ${fmtInt(dataset.window.people)} people in ${dataset.server.name}. Every person counts once, so one loud poster cannot set the mood. ${fmtPct(dataset.window.negativePeopleShare, 0)} of people came away negative, down from ${fmtPct(dataset.window.previousNegativePeopleShare, 0)} the week before.`}
            </p>
          </div>
          <Badge tone={dataset.metadataOnly ? 'warn' : 'live'} dot pulse={false}>
            {dataset.metadataOnly ? '4014, metadata only' : 'People-weighted'}
          </Badge>
        </div>
        <dl className="mt-16 grid gap-x-24 gap-y-0 sm:grid-cols-3">
          <KeyValue label="Window" value={`${fmtDay(dataset.window.start)} to ${fmtDay(dataset.window.end)}`} />
          <KeyValue label="People counted" value={fmtInt(dataset.window.people)} />
          <KeyValue label="Negative share" value={negative} />
        </dl>
      </section>

      {insights.length === 0 ? (
        <EmptyState icon={Lightbulb} sentence="No insight cleared the evidence bar for this window, so there is nothing to rank yet." actionLabel="Backfill another day" onAction={() => onOpenQuotes(null, 'All linked messages', 24)} />
      ) : (
        <ul className="flex flex-col">
          {insights.map((insight) => {
            const tone = severityTone(insight.severity) as Tone
            return (
              <li key={insight.id} className="flex flex-wrap items-start gap-12 border-b border-line py-16 last:border-b-0">
                <span aria-hidden className={cn('mt-6 size-8 shrink-0 rounded-full', toneBg[tone])} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-8">
                    <h4 className="text-label font-medium text-ink">{insight.title}</h4>
                    <TrendBadge trend={insight.trend} />
                  </div>
                  <p className="mt-4 max-w-prose text-label text-muted">{insight.detail}</p>
                  <p className="mt-4 flex flex-wrap items-center gap-8 text-micro text-subtle">
                    <span className="font-mono">{insight.channel}</span>
                    <span>{fmtInt(insight.messageCount)} linked messages</span>
                    <span>{dataset.metadataOnly ? 'metadata only' : 'content read, then discarded'}</span>
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onOpenQuotes(insight.topicId, insight.title, insight.messageCount)} className="shrink-0">
                  View {fmtInt(insight.messageCount)} messages
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex items-center gap-8 rounded-8 border border-line px-12 py-8">
        <MessageSquare aria-hidden className="size-14 shrink-0 text-muted" />
        <p className="text-micro text-muted">
          Quotes are short excerpts from fictional members. Discord Daemon keeps counts, not conversations, and no profile history is stored for ordinary members.
        </p>
      </div>
    </div>
  )
}
