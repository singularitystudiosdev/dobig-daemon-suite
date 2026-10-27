/* Local components for the Creator Dox page. They live in this folder because the shared
   barrel stays untouched; anything reusable across daemons belongs in src/components/ui. */

import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp, fmtSignedPct } from '@/lib/format'
import { createRng } from '@/lib/random'
import { toneBg, toneText, type Tone } from '@/lib/tone'
import { Badge, Button, useToast } from '@/components/ui'
import { AS_OF, type Grade } from './data'

/** The tooltip every public metric carries: the YouTube Data API field it came from. */
export function apiTitle(field: string): string {
  return `${field}, as of ${AS_OF}`
}

const gradeClass: Record<Grade, string> = {
  'A++': 'border-live bg-live-soft text-live',
  'A+': 'border-live bg-live-soft text-live',
  A: 'border-accent-ink bg-accent-soft text-accent-ink',
  'B+': 'border-accent-ink bg-accent-soft text-accent-ink',
  B: 'border-warn bg-warn-soft text-warn',
  C: 'border-warn bg-warn-soft text-warn',
}

/* The Social Blade style grade chip: one letter pair, one tone. */
export function GradeChip({ grade, className }: { grade: Grade; className?: string }) {
  return (
    <span
      data-slot="grade-chip"
      title={`Social Blade grade ${grade}, as of ${AS_OF}`}
      className={cn('inline-flex shrink-0 items-center gap-6 rounded-full border px-12 py-4 text-label font-bold', gradeClass[grade], className)}
    >
      <span className="text-micro font-medium">Grade</span>
      <span className="tabular text-stat">{grade}</span>
    </span>
  )
}

/** Marks a value the tool estimates rather than reads from the API. */
export function ModelledTag({ className }: { className?: string }) {
  return (
    <Badge tone="warn" className={className}>
      Modelled
    </Badge>
  )
}

/** A horizontal gauge that fills by transform, never by width. */
export function Meter({
  label,
  value,
  max,
  tone,
  format,
  ariaLabel,
  className,
}: {
  label: string
  value: number
  max: number
  tone: Tone
  format: (n: number) => string
  ariaLabel: string
  className?: string
}) {
  const pct = clamp(max > 0 ? value / max : 0)
  return (
    <div data-slot="meter" className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-8">
        <span className="text-label text-muted">{label}</span>
        <span className={cn('tabular font-mono text-stat font-bold', toneText[tone])}>{format(value)}</span>
      </div>
      <div
        role="meter"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        className="mt-4 h-6 overflow-hidden rounded-full bg-raised"
      >
        <div
          className={cn('h-full w-full origin-left rounded-full transition-transform duration-200 ease-standard motion-reduce:transition-none', toneBg[tone])}
          style={{ transform: `scaleX(${pct})` }}
        />
      </div>
    </div>
  )
}

/** A modelled bar: hatched fill, percent at the end. Width comes from the data, inline. */
export function HatchedBar({
  label,
  pct,
  tone = 'data5',
  className,
}: {
  label: string
  pct: number
  tone?: 'data5' | 'data6'
  className?: string
}) {
  const fill = tone === 'data5' ? 'bg-data-5-soft text-data-5' : 'bg-data-6-soft text-data-6'
  return (
    <div data-slot="hatched-bar" className={cn('flex items-center gap-8', className)}>
      <span className="w-96 shrink-0 truncate text-label text-muted">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="block h-8 overflow-hidden rounded-full bg-sunken">
          <span className={cn('block h-full rounded-full hatch', fill)} style={{ width: `${clamp(pct / 100) * 100}%` }} />
        </span>
      </span>
      <span className="tabular w-48 shrink-0 text-right font-mono text-micro text-ink">{Math.round(pct)}%</span>
    </div>
  )
}

/** A delta against organic engagement: danger when the audience tunes out. */
export function DeltaValue({ delta, className }: { delta: number; className?: string }) {
  const tunesOut = delta <= -0.25
  return <span className={cn('tabular font-mono', tunesOut ? 'text-danger' : 'text-live', className)}>{fmtSignedPct(delta, 0)}</span>
}

/** Copies the public business email. Nothing privileged is ever stored here. */
export function CopyButton({ text, label = 'Copy email' }: { text: string; label?: string }) {
  const { push } = useToast()
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      push({ title: 'Email copied', description: 'The public business address is on your clipboard.', tone: 'ok' })
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      push({ title: 'Copy blocked', description: 'Clipboard access was refused. Select the address and copy it manually.', tone: 'warn' })
    }
  }
  return (
    <Button size="sm" variant="normal" icon={copied ? Check : Copy} onClick={onCopy}>
      {copied ? 'Copied' : label}
    </Button>
  )
}

/**
 * The 1,000-dot subscriber field. Dots read as human until the credibility share greys them;
 * `progress` (0..1) is how far through the credibility scan the run is. Decorative: the
 * caller always prints the percentage as text beside it.
 */
export function DotField({
  credibilityPct,
  progress = 1,
  seed,
  className,
}: {
  credibilityPct: number
  progress?: number
  seed: string
  className?: string
}) {
  const order = useMemo(() => {
    const rng = createRng(`dots-${seed}`)
    const count = Math.round(1000 * (1 - credibilityPct / 100))
    const set = new Set<number>()
    while (set.size < count) set.add(rng.int(0, 999))
    return [...set]
  }, [seed, credibilityPct])
  const shown = Math.round((order.length * clamp(progress)) / 20) * 20
  const revealed = useMemo(() => new Set(order.slice(0, shown)), [order, shown])
  const dots = useMemo(
    () =>
      Array.from({ length: 1000 }, (_, i) => (
        <span key={i} className={cn('size-2 shrink-0 rounded-full', revealed.has(i) ? 'bg-line-strong' : 'bg-accent-ink opacity-40')} />
      )),
    [revealed],
  )
  return (
    <div aria-hidden data-slot="dot-field" className={cn('flex max-w-160 flex-wrap gap-1', className)}>
      {dots}
    </div>
  )
}
