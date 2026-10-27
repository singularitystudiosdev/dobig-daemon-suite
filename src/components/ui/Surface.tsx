import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { toneBg, toneSoft, toneText, type Tone } from '@/lib/tone'

/* Panel: a 20px surface with a hairline and no resting shadow. Never nest a Panel in a Panel;
   inside a panel use rows, tables or 8px raised blocks. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} data-slot="panel" className={cn('min-w-0 rounded-20 border border-line bg-surface', className)}>
      {(title || actions) && (
        <header data-slot="panel-header" className="flex flex-wrap items-start justify-between gap-16 px-24 pt-24">
          <div className="min-w-0">
            {title && <h2 className="text-title font-bold text-ink">{title}</h2>}
            {description && <p className="mt-4 max-w-prose text-label text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-8">{actions}</div>}
        </header>
      )}
      <div data-slot="panel-body" className={cn('p-24', bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

/* The dobig.com stat pill: label left in muted, value right in bold. */
export function StatPill({ label, value, tone = 'ink', className }: { label: ReactNode; value: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div data-slot="stat-pill" className={cn('flex min-w-0 items-center justify-between gap-8 rounded-8 bg-raised px-12 py-8', className)}>
      <span className="min-w-0 truncate whitespace-nowrap text-label text-muted">{label}</span>
      <span className={cn('tabular shrink-0 whitespace-nowrap text-stat font-bold', toneText[tone])}>{value}</span>
    </div>
  )
}

/* A labelled metric block for dense rows: small label over a big tabular value. */
export function Metric({
  label,
  value,
  hint,
  tone = 'ink',
  size = 'headline',
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  size?: 'headline' | 'title' | 'mega'
  className?: string
}) {
  const sizeClass = size === 'mega' ? 'text-mega' : size === 'title' ? 'text-title font-bold' : 'text-headline'
  return (
    <div data-slot="metric" className={cn('min-w-0', className)}>
      <div className="text-label text-muted">{label}</div>
      <div className={cn('tabular mt-4', sizeClass, toneText[tone])}>{value}</div>
      {hint && <div className="mt-4 text-micro text-subtle">{hint}</div>}
    </div>
  )
}

export function Badge({ tone = 'muted', dot, pulse, children, className }: { tone?: Tone; dot?: boolean; pulse?: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      data-slot="badge"
      className={cn('inline-flex shrink-0 items-center gap-6 whitespace-nowrap rounded-full px-8 py-2 text-micro font-medium', toneSoft[tone], toneText[tone], className)}
    >
      {dot && <LiveDot tone={tone} pulse={pulse} />}
      {children}
    </span>
  )
}

export function LiveDot({ tone = 'live', pulse = true, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span data-slot="live-dot" aria-hidden className={cn('relative inline-flex size-8 shrink-0', className)}>
      {pulse && <span className={cn('absolute inset-0 rounded-full motion-safe:animate-pulse-dot', toneBg[tone])} />}
      <span className={cn('relative inline-flex size-8 rounded-full', toneBg[tone])} />
    </span>
  )
}

/* A key:value row for detail lists. */
export function KeyValue({ label, value, mono, className }: { label: ReactNode; value: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div data-slot="key-value" className={cn('flex items-baseline justify-between gap-16 border-b border-line py-8 last:border-b-0', className)}>
      <dt className="text-label text-muted">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-label text-ink', mono && 'font-mono text-micro')}>{value}</dd>
    </div>
  )
}

/* Mono chip for ids, field names, hashes and API paths. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <code className={cn('rounded-8 bg-raised px-6 py-2 font-mono text-micro text-ink', className)}>{children}</code>
}
