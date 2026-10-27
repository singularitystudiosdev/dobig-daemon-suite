import { useState, ViewTransition } from 'react'
import { Gamepad2, MessagesSquare, Plus, X } from 'lucide-react'
import { EmptyState, IconButton, ProgressBar, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { DaemonRecord } from '@/lib/runTypes'
import { toneText, type Tone } from '@/lib/tone'
import type { EntryStatus } from '../types'
import { ago } from './time'

/* The right-hand list. It IS the daemon list: one row per daemon the server holds for this tool, so reopening the
   dashboard brings every target back. Rows show the target, a live status line, and a remove button; a + sits under
   the list. */

export interface RailItem {
  /** The entry id: `u<universeId>` or `g<guildId>`. */
  id: string
  name: string
  image: string | null
  daemon: DaemonRecord
}

export type RailNoun = 'game' | 'server'

/** What a row says before its workspace has reported anything. Comes from the server record alone. */
function fallbackStatus(d: DaemonRecord): { label: string; tone: Tone } {
  if (d.activeRunId) return { label: 'Running now', tone: 'live' }
  if (d.last?.status === 'failed') return { label: `Last run failed ${ago(d.last.startedAt)}`, tone: 'danger' }
  if (!d.enabled) return { label: 'Paused', tone: 'warn' }
  if (d.last) return { label: `${d.last.findings} ${d.last.findings === 1 ? 'finding' : 'findings'}, ${ago(d.last.startedAt)}`, tone: 'muted' }
  return { label: 'Waiting for the first run', tone: 'muted' }
}

/** The row's picture. A missing or unreachable image falls back to the target's first letter, never a broken-image icon. */
function RailThumb({ image, name }: { image: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (!image || failed) return <span aria-hidden className="text-title font-bold text-muted">{name.trim().charAt(0).toUpperCase() || '?'}</span>
  return <img src={image} alt="" width={96} height={54} onError={() => setFailed(true)} className="size-full object-cover" />
}

export function GameRail({
  items,
  statuses,
  selectedId,
  adding,
  loading,
  failed,
  noun,
  onSelect,
  onRemove,
  onAdd,
  onRetry,
}: {
  items: RailItem[]
  statuses: Record<string, EntryStatus>
  selectedId: string | null
  adding: boolean
  loading: boolean
  failed: boolean
  noun: RailNoun
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onRetry: () => void
}) {
  const Icon = noun === 'game' ? Gamepad2 : MessagesSquare
  const plural = noun === 'game' ? 'Games' : 'Servers'
  return (
    <aside aria-label={plural} className="flex min-w-0 flex-col gap-12 rounded-20 border border-line bg-surface p-16 lg:sticky lg:top-80 lg:self-start">
      <h2 className="flex items-baseline justify-between px-4 text-title font-bold">
        {plural}
        <span className="tabular text-label font-medium text-muted">{loading ? '' : items.length}</span>
      </h2>
      {loading ? (
        <ul aria-busy aria-label={`Loading your ${plural.toLowerCase()}`} className="flex flex-col gap-8">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center gap-12 rounded-8 border border-line p-8">
              <Skeleton className="aspect-video w-96 shrink-0" />
              <div className="flex flex-1 flex-col gap-8">
                <Skeleton className="h-12 w-4/5" />
                <Skeleton className="h-10 w-1/2" />
              </div>
            </li>
          ))}
        </ul>
      ) : failed ? (
        <EmptyState icon={Icon} sentence={`Your ${plural.toLowerCase()} did not load from the server.`} actionLabel="Retry" onAction={onRetry} className="px-8" />
      ) : items.length === 0 ? (
        <EmptyState icon={Icon} sentence={`${plural} you add are watched here and rerun every 12 hours.`} actionLabel={`Add a ${noun}`} onAction={onAdd} className="px-8" />
      ) : (
        <ul className="flex flex-col gap-8">
          {items.map((item) => {
            const selected = !adding && item.id === selectedId
            const reported = statuses[item.id]
            const fallback = fallbackStatus(item.daemon)
            const label = reported?.label ?? fallback.label
            const tone = reported?.tone ?? fallback.tone
            return (
              <li key={item.id} className="relative">
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(item.id)}
                  className={cn('state-layer flex w-full items-center gap-12 rounded-8 border p-8 pr-40 text-left', selected ? 'border-accent bg-raised' : 'border-line')}
                >
                  <ViewTransition name={`game-${item.id}`} share="game-morph" default="none">
                    <span className="flex aspect-video w-96 shrink-0 items-center justify-center overflow-hidden rounded-8 bg-raised">
                      <RailThumb image={item.image} name={item.name} />
                    </span>
                  </ViewTransition>
                  <span className="flex min-w-0 flex-1 flex-col gap-4">
                    <span className="truncate text-label font-medium text-ink">{item.name}</span>
                    <span className={cn('truncate text-micro', toneText[tone])}>{label}</span>
                    {reported?.progress !== undefined && <ProgressBar value={reported.progress} tone={reported.tone} size="sm" label={`${item.name} progress`} />}
                  </span>
                </button>
                <IconButton label={`Remove ${item.name}`} icon={X} size="sm" onClick={() => onRemove(item.id)} className="absolute right-4 top-4" />
              </li>
            )
          })}
        </ul>
      )}
      {!loading && !failed && items.length > 0 && (
        <button
          type="button"
          aria-label={`Add another ${noun}`}
          onClick={onAdd}
          className={cn(
            'state-layer flex h-40 w-full items-center justify-center gap-8 rounded-8 border border-dashed text-label font-medium',
            adding ? 'border-accent text-accent-ink' : 'border-line-strong text-muted',
          )}
        >
          <Plus aria-hidden className="size-16" />
          Add another {noun}
        </button>
      )}
    </aside>
  )
}
