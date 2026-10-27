import { Check, ExternalLink } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Sentiment, SentimentDetail } from '@/lib/details/sentiment'
import type { Tone } from '@/lib/tone'
import type { DetailViewProps } from './types'

/* The expanded row of a sentiment finding: where the topic sits from -1 to +1, how many PEOPLE (not messages) feel each way,
   the trend since the last run, where it is discussed, and real short quotes with the exact Discord message link. */

const TONE: Record<Sentiment, Tone> = { negative: 'danger', mixed: 'accent', neutral: 'muted', positive: 'live' }
const LABEL: Record<Sentiment, string> = { negative: 'Negative', mixed: 'Mixed', neutral: 'Neutral', positive: 'Positive' }
const BAR: Record<Sentiment, string> = { negative: 'bg-danger', mixed: 'bg-accent-ink', neutral: 'bg-muted', positive: 'bg-live' }
const ORDER: Sentiment[] = ['negative', 'mixed', 'neutral', 'positive']

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}`
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function trendText(d: SentimentDetail): string {
  if (!d.trend) return 'No trend yet: this is the first run that saw this topic.'
  const { delta, previousScore } = d.trend
  if (Math.abs(delta) < 0.05) return `Steady: ${signed(delta)} since the last run (it was ${signed(previousScore)}).`
  return `${delta < 0 ? 'Down' : 'Up'} ${Math.abs(delta).toFixed(2)} since the last run (it was ${signed(previousScore)}, now ${signed(d.score)}).`
}

export function ScoreGauge({ score }: { score: number }) {
  const pos = ((Math.max(-1, Math.min(1, score)) + 1) / 2) * 100
  const left = score < 0 ? pos : 50
  const width = Math.abs(pos - 50)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-12">
        <span className="text-label text-muted">Sentiment score</span>
        <span className={cn('tabular text-stat font-bold', score <= -0.15 ? 'text-danger' : score >= 0.15 ? 'text-live' : 'text-ink')}>{signed(score)}</span>
      </div>
      <div role="img" aria-label={`Score ${signed(score)} on a scale from -1 to +1`} className="relative mt-8 h-8 rounded-full bg-raised">
        <span aria-hidden className={cn('absolute inset-y-0 rounded-full', score < 0 ? 'bg-danger' : 'bg-live')} style={{ left: `${left}%`, width: `${width}%` }} />
        <span aria-hidden className="absolute -inset-y-2 left-1/2 w-2 bg-line-strong" />
      </div>
      <div aria-hidden className="tabular mt-4 flex justify-between text-micro text-subtle">
        <span>-1 all negative</span>
        <span>0</span>
        <span>+1 all positive</span>
      </div>
    </div>
  )
}

export default function SentimentDetailView({ detail: d, state, act }: DetailViewProps<SentimentDetail>) {
  const reviewed = state === 'reviewed'
  return (
    <div className="flex flex-col gap-16">
      <div className="grid grid-cols-1 gap-24 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-16">
          <ScoreGauge score={d.score} />
          <div className="flex flex-col gap-8">
            <h3 className="text-label font-medium text-muted">
              People by stance <span className="font-normal text-subtle">({d.people} people, {d.messages} messages, each person counted once)</span>
            </h3>
            <ul className="flex flex-col gap-8">
              {ORDER.map((s) => {
                const n = d.shares[s]
                const pct = d.people > 0 ? (n / d.people) * 100 : 0
                return (
                  <li key={s} className="flex items-center gap-12">
                    <span className="w-72 shrink-0 text-label text-ink">{LABEL[s]}</span>
                    <span className="h-8 min-w-0 flex-1 overflow-hidden rounded-full bg-raised">
                      <span className={cn('block h-full rounded-full', BAR[s])} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="tabular w-80 shrink-0 text-right text-label text-muted">
                      {n} {n === 1 ? 'person' : 'people'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
          <p className="text-label text-muted">{trendText(d)}</p>
          {d.confidenceNote && <p className="rounded-8 bg-warn-soft px-12 py-8 text-label text-warn">{d.confidenceNote}</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          <div className="flex flex-col gap-4">
            <h3 className="text-label font-medium text-muted">Where people talked about it</h3>
            <ul>
              {d.channels.map((c) => (
                <li key={c.name} className="flex items-baseline justify-between gap-12 border-b border-line py-8 last:border-b-0">
                  <span className="min-w-0 truncate text-label text-ink">#{c.name}</span>
                  <span className="tabular shrink-0 text-label text-muted">
                    {c.people} {c.people === 1 ? 'person' : 'people'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4">
            <h3 className="text-label font-medium text-muted">What people wrote</h3>
            <ul>
              {d.quotes.map((q) => (
                <li key={q.url} className="flex flex-col gap-6 border-b border-line py-12 first:pt-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-8">
                    <span className="text-label font-medium text-ink">{q.author}</span>
                    <Badge tone={TONE[q.sentiment]}>{LABEL[q.sentiment]}</Badge>
                    <span className="tabular text-micro text-subtle">{when(q.at)}</span>
                  </div>
                  <p className="max-w-prose text-label text-ink">&ldquo;{q.text}&rdquo;</p>
                  <div className="flex flex-wrap items-center gap-x-12 gap-y-4">
                    <a href={q.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-6 text-label text-accent-ink">
                      Open in Discord
                      <ExternalLink aria-hidden className="size-12" />
                    </a>
                    <span className="break-all font-mono text-micro text-subtle">{q.url}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-12 border-t border-line pt-12">
        {reviewed ? (
          <Badge tone="muted" dot pulse={false}>
            Reviewed
          </Badge>
        ) : (
          <Button size="sm" variant="primary" icon={Check} onClick={() => act('reviewed')}>
            Mark reviewed
          </Button>
        )}
        <span className="text-micro text-subtle">Kept in this session only. Quotes are short excerpts from your own server; nothing is posted back.</span>
      </div>
    </div>
  )
}
