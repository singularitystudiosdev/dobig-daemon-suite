import { ArrowDownRight, CloudSun, ExternalLink, MessagesSquare } from 'lucide-react'
import { fmtDay, fmtInt, fmtPct } from '@/lib/format'
import { daemonHref } from '@/lib/router'
import { busFor } from '@/data/bus'
import type { Game } from '@/data/games'
import { Badge, Button, EmptyState } from '@/components/ui'
import { quotesFor, type DiscordDataset } from '../data'
import { CauseBar, DeltaValue, SentimentValue, TextEquivalent } from '../parts'

/* Mood drops: the days sentiment fell, the causes ranked against each fall, and the messages
   behind the biggest one. The Oct 23 cause cross-references Hack Daemon's exploit cluster. */

export function MoodDropsTab({
  dataset,
  game,
  onOpenQuotes,
  onOpenConnect,
}: {
  dataset: DiscordDataset
  game: Game
  onOpenQuotes: (topicId: string | null, title: string, total: number) => void
  onOpenConnect: () => void
}) {
  const exploit = busFor(game).find((e) => e.kind === 'exploit-surge')
  const series = dataset.mood.series
  if (dataset.metadataOnly) {
    return (
      <div className="flex flex-col gap-16">
        <div className="rounded-8 border border-warn bg-warn-soft px-16 py-12">
          <p className="text-label text-ink">MESSAGE_CONTENT is not approved for this bot, so the mood timeline cannot be computed.</p>
          <p className="mt-4 text-micro text-muted">Metadata still gives you posting volume per day, but not how the server felt about it.</p>
        </div>
        <EmptyState
          icon={CloudSun}
          sentence="Approve MESSAGE_CONTENT on the bot application to read the 7-day sentiment line and its ranked causes."
          actionLabel="Review intents"
          onAction={onOpenConnect}
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-24">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-16">
          <div>
            <h3 className="text-title font-bold text-ink">Daily sentiment, people-weighted</h3>
            <p className="mt-4 max-w-prose text-label text-muted">
              {dataset.insights[0]?.title ?? 'The week held steady'} set the tone. Sentiment fell on {dataset.mood.drops.length} days, and every drop below names the topics that moved first.
            </p>
          </div>
          <Badge tone="danger">{fmtPct(Math.abs(dataset.mood.drops[0].delta), 0)} largest drop</Badge>
        </div>
        <figure className="m-0 mt-16 rounded-8 border border-line bg-sunken px-16 py-12">
          <svg viewBox="0 0 720 160" role="img" aria-label="Daily sentiment, Oct 19 to Oct 26, showing a drop of 0.21 on Oct 23." className="h-auto w-full">
            {series.map((point, i) => {
              const w = 720 / series.length
              const zero = 96
              const scale = 210
              const h = Math.abs(point.sentiment) * scale
              const up = point.sentiment >= 0
              return (
                <g key={point.date}>
                  <rect
                    x={i * w + 18}
                    y={up ? zero - h : zero}
                    width={w - 36}
                    height={Math.max(2, h)}
                    rx={4}
                    className={point.date === '2026-10-23' ? 'fill-danger' : up ? 'fill-live' : 'fill-warn'}
                    opacity={0.75}
                  />
                  <text x={i * w + w / 2} y={150} textAnchor="middle" className="fill-subtle text-micro">
                    {fmtDay(point.date + 'T12:00:00Z')}
                  </text>
                  <text x={i * w + w / 2} y={up ? zero - h - 6 : zero + h + 14} textAnchor="middle" className="fill-muted text-micro">
                    {point.sentiment > 0 ? '+' : ''}
                    {point.sentiment.toFixed(2)}
                  </text>
                </g>
              )
            })}
            <line x1={0} y1={96} x2={720} y2={96} className="stroke-line-strong" strokeWidth={1} />
          </svg>
          <TextEquivalent>
            Oct 19 +0.20, Oct 20 +0.11, Oct 21 +0.16, Oct 22 +0.09, Oct 23 -0.12, Oct 24 -0.04, Oct 25 +0.03, Oct 26 +0.08. The Oct 23 drop is 0.21.
          </TextEquivalent>
        </figure>
      </section>

      <section>
        <h3 className="text-title font-bold text-ink">Drops with ranked causes</h3>
        <p className="mt-4 max-w-prose text-label text-muted">A cause is a hypothesis ranked by message overlap and timing, never a proven effect. Confidence is the share of the fall explained by people posting in that topic.</p>
        {dataset.mood.drops.length === 0 ? (
          <EmptyState icon={CloudSun} sentence="No day lost enough sentiment to rank as a drop, so there is nothing to explain." actionLabel="Review the mood chart" onAction={() => window.scrollTo({ top: 0 })} />
        ) : (
        <ul className="mt-12 flex flex-col">
          {[...dataset.mood.drops].sort((a, b) => (a.date < b.date ? 1 : -1)).map((drop) => {
            const top = dataset.mood.drops[0]
            return (
              <li key={drop.date} className="grid gap-16 border-b border-line py-16 last:border-b-0 lg:grid-cols-12">
                <div className="lg:col-span-3">
                  <div className="flex items-center gap-8 text-label text-ink">
                    <ArrowDownRight aria-hidden className="size-14 text-danger" />
                    {fmtDay(drop.date + 'T12:00:00')}
                  </div>
                  <div className="mt-4 flex items-baseline gap-8">
                    <DeltaValue delta={drop.delta} />
                    <span className="text-micro text-subtle">people-weighted</span>
                  </div>
                  <div className="mt-8">
                    <SentimentValue value={dataset.mood.series.find((s) => s.date === drop.date)?.sentiment ?? 0} className="text-micro" />
                    <span className="ml-6 text-micro text-subtle">that day</span>
                  </div>
                </div>
                <div className="lg:col-span-6">
                  <p className="text-micro text-muted">Ranked causes</p>
                  <ul className="mt-8 flex flex-col gap-12">
                    {drop.causes.map((cause) => {
                      const topic = dataset.topics.find((t) => t.id === cause.topicId)
                      if (!topic) return null
                      return <li key={cause.topicId}><CauseBar label={topic.label} confidence={cause.confidence} /></li>
                    })}
                  </ul>
                  {drop.date === top.date && exploit && (
                    <a
                      href={daemonHref('hack-daemon', { focus: 'clusters' })}
                      className="mt-12 flex items-start gap-8 rounded-8 border border-line bg-raised px-12 py-8 text-micro text-muted transition-colors duration-150 hover:text-ink"
                    >
                      <ExternalLink aria-hidden className="mt-2 size-14 shrink-0 text-accent-ink" />
                      <span>
                        <span className="block text-label text-ink">Hack Daemon saw the same surge</span>
                        {exploit.detail}. Confidence on the dupe cause rose after the two events lined up.
                      </span>
                    </a>
                  )}
                </div>
                <div className="flex flex-col items-start gap-8 lg:col-span-3 lg:items-end">
                  <span className="tabular font-mono text-micro text-muted">{fmtInt(drop.causes.reduce((a, c) => a + (dataset.topics.find((t) => t.id === c.topicId)?.messages ?? 0), 0))} messages</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const topic = dataset.topics.find((t) => t.id === drop.causes[0].topicId) ?? dataset.topics[0]
                      onOpenQuotes(topic.id, `${fmtDay(drop.date + 'T12:00:00')} drop, linked messages`, topic.messages)
                    }}
                  >
                    <MessagesSquare aria-hidden className="size-14" />
                    View linked messages
                  </Button>
                  <span className="text-micro text-subtle">{quotesFor(dataset, drop.causes[0].topicId, 1).length > 0 ? 'quotes available' : 'no quotes kept'}</span>
                </div>
              </li>
            )
          })}
        </ul>
        )}
      </section>
    </div>
  )
}
