import type { ReactNode } from 'react'
import { clamp } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui'
import type { Simulation } from '@/lib/useSimulation'
import type { CopyVariant, DescriptionDataset } from './data'

/* Three drafts of the same description. Variant A is the live copy, B is the survivor, C is the
   bait draft lint blocks. Everything types out on sim time and the strikes land one rule at a
   time during the lint stage. */

function statusOf(variant: CopyVariant, sim: Simulation): CopyVariant['status'] {
  if (variant.lint.length > 0 && sim.reached('lint')) return 'blocked'
  if (variant.id === 'v-b') {
    if (sim.reached('verdict')) return 'kept'
    if (sim.reached('hold')) return 'live'
  }
  return 'draft'
}

const toneFor: Record<CopyVariant['status'], 'muted' | 'danger' | 'live' | 'warn'> = {
  draft: 'muted',
  blocked: 'danger',
  live: 'live',
  kept: 'live',
  'rolled back': 'warn',
}

function DescriptionText({ variant, sim, showLint }: { variant: CopyVariant; sim: Simulation; showLint: boolean }) {
  const gp = sim.within('generate')
  const index = variant.id === 'v-a' ? 0 : variant.id === 'v-b' ? 1 : 2
  const typed = Math.floor(clamp((gp - index * 0.08) / 0.78) * variant.description.length)
  const text = sim.reached('generate') ? variant.description.slice(0, typed) : ''

  if (!showLint || variant.lint.length === 0) {
    return (
      <p className="whitespace-pre-line break-words text-label text-ink">
        {text}
        {sim.reached('generate') && typed < variant.description.length && <span className="motion-safe:animate-blink text-accent-ink">|</span>}
      </p>
    )
  }

  const spans = [...variant.lint].sort((a, b) => a.span[0] - b.span[0])
  const parts: ReactNode[] = []
  let cursor = 0
  spans.forEach((s, i) => {
    if (s.span[0] > cursor) parts.push(<span key={`t${i}`}>{variant.description.slice(cursor, s.span[0])}</span>)
    parts.push(
      <span
        key={`s${i}`}
        className="border-b-2 border-danger text-danger line-through decoration-danger decoration-2"
        aria-label={`${s.rule}: ${variant.description.slice(s.span[0], s.span[1])}`}
      >
        {variant.description.slice(s.span[0], s.span[1])}
      </span>,
    )
    parts.push(
      <span key={`r${i}`} className="ml-4 inline-flex align-middle">
        <Badge tone="danger">{s.rule}</Badge>
      </span>,
    )
    cursor = s.span[1]
  })
  if (cursor < variant.description.length) parts.push(<span key="tail">{variant.description.slice(cursor)}</span>)
  return <p className="whitespace-pre-line break-words text-label text-ink">{parts}</p>
}

export function CopyCards({ data, sim }: { data: DescriptionDataset; sim: Simulation }) {
  const lintP = sim.reached('lint') ? sim.within('lint') : 0

  return (
    <div data-slot="copy-cards" className="overflow-hidden rounded-8 border border-line bg-sunken">
      <div className="flex flex-wrap items-center justify-between gap-8 border-b border-line px-12 py-8">
        <span className="text-label font-medium text-ink">Drafts from the live copy</span>
        <span className="text-micro text-muted">One variable per test. Variant A is the control.</span>
      </div>
      <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        {data.variants.map((variant, index) => {
          const status = statusOf(variant, sim)
          const shownLint = variant.lint.filter((_, i) => lintP > (i + 0.6) / (variant.lint.length + 0.6))
          const showLint = sim.reached('lint') && shownLint.length > 0
          const revealed = showLint ? shownLint : []
          const blocked = status === 'blocked'
          return (
            <article key={variant.id} className={cn('flex min-w-0 flex-col gap-8 p-12', blocked && 'bg-danger-soft')}>
              <header className="flex items-center justify-between gap-8">
                <h3 className="text-label font-medium text-ink">
                  {variant.displayName}
                  <span className="ml-4 text-micro font-normal text-muted">{index === 0 ? 'control' : index === 1 ? 'candidate' : 'bait draft'}</span>
                </h3>
                <Badge tone={toneFor[status]}>{status}</Badge>
              </header>

              <div className="min-h-120 flex-1">
                <DescriptionText variant={variant} sim={sim} showLint={showLint} />
              </div>

              {revealed.length > 0 && (
                <p className="text-micro text-danger">
                  {revealed.length} {revealed.length === 1 ? 'rule' : 'rules'} flagged. Roblox demotes this metadata.
                </p>
              )}

              <footer className="border-t border-line pt-8 text-micro text-muted">
                {variant.id === 'v-a' && `${variant.description.length} chars, source: current live description`}
                {variant.id === 'v-b' && (sim.reached('hold') ? 'Live on Home traffic, one change at a time' : sim.reached('lint') ? '3 of 3 lint rules pass, ready to publish' : 'Candidate, waiting on lint')}
                {variant.id === 'v-c' && (blocked ? `${Math.max(1, revealed.length)} of 3 rules failed, never published` : 'Giveaway wording and a keyword run')}
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}
