import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp } from '@/lib/format'
import { toneBg, type Tone } from '@/lib/tone'
import { Button } from './Button'

/* Progress fills by transform (scaleX) so it never triggers layout. */
export function ProgressBar({ value, tone = 'accent', label, className, size = 'md' }: { value: number; tone?: Tone; label?: string; className?: string; size?: 'sm' | 'md' }) {
  const v = clamp(value)
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cn('overflow-hidden rounded-full bg-raised', size === 'sm' ? 'h-4' : 'h-6', className)}
    >
      <div
        className={cn('h-full w-full origin-left rounded-full transition-transform duration-100 ease-linear motion-reduce:transition-none', toneBg[tone])}
        style={{ transform: `scaleX(${v})` }}
      />
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div data-slot="skeleton" aria-hidden className={cn('rounded-8 bg-raised motion-safe:animate-pulse', className)} />
}

/* Skeleton rows that match a list row: a 32px leading mark, a title line and a snippet line. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div data-slot="skeleton-rows" aria-busy className={cn('flex flex-col', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-12 border-b border-line py-12 last:border-b-0">
          <Skeleton className="size-32 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Skeleton className="h-12 w-1/2" />
            <Skeleton className="h-10 w-4/5" />
          </div>
          <Skeleton className="h-12 w-48" />
        </div>
      ))}
    </div>
  )
}

/* Empty state: exactly one sentence and one action (anti-generic rule 21). */
export function EmptyState({ icon: Icon, sentence, actionLabel, onAction, className }: { icon: LucideIcon; sentence: ReactNode; actionLabel: string; onAction: () => void; className?: string }) {
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-center gap-12 px-24 py-32 text-center', className)}>
      <Icon aria-hidden className="size-20 text-muted" />
      <p className="max-w-prose text-label text-muted">{sentence}</p>
      <Button size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  )
}
