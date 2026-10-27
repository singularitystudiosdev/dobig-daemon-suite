import { useId } from 'react'
import { ArrowDownRight, ArrowUpRight, MessageSquare, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDayTime, fmtInt, fmtPct } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { Badge, Dialog, EmptyState, ProgressBar } from '@/components/ui'
import type { Category, Confidence, MessageQuote, Trend } from './data'

/* Local parts for the Discord Daemon page. Everything here is presentation only: the shared
   components stay untouched, and the connectors that are specific to sentiment stay here. */

export const categoryTone: Record<Category, Tone> = {
  'Issues & Bugs': 'danger',
  'User Feedback': 'live',
  'General Questions': 'accent',
  'Marketing Ideas': 'data6',
}

export function CategoryChip({ category, className }: { category: Category; className?: string }) {
  return (
    <Badge tone={categoryTone[category]} className={className}>
      {category}
    </Badge>
  )
}

const trendMeta: Record<Trend, { tone: Tone; icon: typeof Minus; label: string }> = {
  stable: { tone: 'muted', icon: Minus, label: 'Stable' },
  'cooling off': { tone: 'warn', icon: ArrowDownRight, label: 'Cooling off' },
  'getting worse': { tone: 'danger', icon: ArrowUpRight, label: 'Getting worse' },
}

export function TrendBadge({ trend, className }: { trend: Trend; className?: string }) {
  const meta = trendMeta[trend]
  const Icon = meta.icon
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon aria-hidden className="size-12" />
      {meta.label}
    </Badge>
  )
}

export function SentimentValue({ value, available = true, className }: { value: number; available?: boolean; className?: string }) {
  if (!available) return <Unavailable label="No content" />
  const tone = value <= -0.25 ? 'text-danger' : value < 0.15 ? 'text-warn' : 'text-live'
  return (
    <span className={cn('tabular font-mono text-label', tone, className)}>
      {value > 0 ? '+' : ''}
      {value.toFixed(2)}
    </span>
  )
}

export function Unavailable({ label = 'Not available' }: { label?: string }) {
  return (
    <Badge tone="muted" className="font-mono">
      {label}
    </Badge>
  )
}

export function DeltaValue({ delta, available = true }: { delta: number; available?: boolean }) {
  if (!available) return <Unavailable label="No content" />
  return (
    <span className={cn('tabular font-mono text-label font-bold', delta < 0 ? 'text-danger' : 'text-live')}>
      {delta > 0 ? '+' : ''}
      {delta.toFixed(2)}
    </span>
  )
}

const confidenceTone: Record<Confidence, Tone> = { high: 'live', medium: 'warn', low: 'danger' }
const confidenceLabel: Record<Confidence, string> = { high: 'Sentiment: high', medium: 'Sentiment: medium', low: 'Sentiment: low' }

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return <Badge tone={confidenceTone[confidence]}>{confidenceLabel[confidence]}</Badge>
}

/* A ranked cause bar: percentage is a share of the drop, not a vote count. */
export function CauseBar({ label, confidence, link }: { label: string; confidence: number; link?: { href: string; text: string } }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-12">
        <span className="min-w-0 truncate text-label text-ink">{label}</span>
        <span className="tabular shrink-0 font-mono text-label text-muted">{fmtPct(confidence / 100, 0)}</span>
      </div>
      <div className="mt-6 h-6 overflow-hidden rounded-full bg-raised">
        <div className="h-full origin-left rounded-full bg-warn" style={{ transform: `scaleX(${confidence / 100})` }} />
      </div>
      {link && (
        <a href={link.href} className="mt-6 inline-flex text-micro text-accent-ink transition-colors duration-150 hover:text-ink">
          {link.text}
        </a>
      )}
    </div>
  )
}

export function RateMeter({ reqPerSec, budget = 50 }: { reqPerSec: number; budget?: number }) {
  const ratio = Math.min(1, reqPerSec / budget)
  const tone: Tone = ratio > 0.8 ? 'danger' : ratio > 0.55 ? 'warn' : 'live'
  return (
    <div data-slot="rate-meter" className="rounded-8 border border-line bg-raised px-12 py-8">
      <div className="flex items-baseline justify-between gap-8">
        <span className="text-micro text-muted">Global request budget</span>
        <span className="tabular font-mono text-micro text-ink">
          {reqPerSec} / {budget} req/s
        </span>
      </div>
      <ProgressBar value={ratio} tone={tone} label="Global request budget, 50 requests per second" size="sm" className="mt-6" />
      <p className="mt-4 text-micro text-subtle">Discord allows 50 requests per second per bot. One 429 today, retried in 1.2s.</p>
    </div>
  )
}

export function QuoteDialog({
  open,
  onOpenChange,
  title,
  quotes,
  total,
  metadataOnly,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  quotes: MessageQuote[]
  total: number
  metadataOnly: boolean
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={`${fmtInt(quotes.length)} short excerpts from ${fmtInt(Math.max(total, quotes.length))} linked messages. Every author is a fictional member of this demo server.`}
      className="w-640"
    >
      {quotes.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          sentence="No linked messages landed in this window, so there is nothing to open yet."
          actionLabel="Close"
          onAction={() => onOpenChange(false)}
        />
      ) : (
        <ul className="scroll-thin flex max-h-420 flex-col gap-8 overflow-y-auto pr-4">
          {quotes.map((quote) => (
            <li key={quote.id} className="border-b border-line py-8 last:border-b-0 motion-safe:animate-enter">
              <div className="flex items-center justify-between gap-12 text-micro">
                <span className="flex min-w-0 items-center gap-8">
                  <span className="font-mono text-muted">{quote.author}</span>
                  <span className="text-subtle">{quote.channel}</span>
                </span>
                <span className="flex shrink-0 items-center gap-8">
                  <span className="tabular text-subtle">{fmtDayTime(quote.at)}</span>
                  <Badge tone={quote.tone === 'negative' ? 'danger' : quote.tone === 'positive' ? 'live' : quote.tone === 'mixed' ? 'warn' : 'muted'}>{quote.tone}</Badge>
                </span>
              </div>
              <p className="mt-6 text-label text-ink">{quote.text ?? 'Content unreadable: MESSAGE_CONTENT is not approved for this bot.'}</p>
              {metadataOnly && <p className="mt-4 font-mono text-micro text-subtle">{quote.id} metadata only</p>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

/* The field legend used under every chart-like visual: the chart's text equivalent. */
export function TextEquivalent({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 text-micro text-muted">{children}</p>
}




/* The shared Toggle's switch is a <button role="switch"> whose label is a sibling <label for>,
   which names it for nobody. This local switch names itself from the visible label so the 4014
   control is announced as a switch with its state. */
export function SwitchField({ checked, onChange, label, description }: { checked: boolean; onChange: (next: boolean) => void; label: string; description: string }) {
  const id = useId()
  const labelId = `${id}-label`
  const descId = `${id}-desc`
  return (
    <div className="flex items-start justify-between gap-16">
      <div className="min-w-0">
        <p id={labelId} className="text-label font-medium text-ink">
          {label}
        </p>
        <p id={descId} className="mt-2 text-micro text-muted">
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descId}
        onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-24 w-44 shrink-0 items-center rounded-full transition-colors duration-150', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span aria-hidden className={cn('inline-block size-18 rounded-full bg-ink transition-transform duration-150 ease-standard motion-reduce:transition-none', checked ? 'translate-x-22' : 'translate-x-4')} />
      </button>
    </div>
  )
}
