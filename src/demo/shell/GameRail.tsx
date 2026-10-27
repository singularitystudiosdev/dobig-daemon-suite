import { ViewTransition } from 'react'
import { Gamepad2, Plus, X } from 'lucide-react'
import { EmptyState, IconButton, ProgressBar } from '@/components/ui'
import { cn } from '@/lib/cn'
import { toneText } from '@/lib/tone'
import type { EntryStatus, GameEntry } from '../types'

/* The right rail: every game the visitor added, its live status line, and a + under the list. */

export function GameRail({
  entries,
  statuses,
  selectedId,
  adding,
  onSelect,
  onRemove,
  onAdd,
  onFocusInput,
}: {
  entries: GameEntry[]
  statuses: Record<string, EntryStatus>
  selectedId: string | null
  adding: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onFocusInput: () => void
}) {
  return (
    <aside aria-label="Games" className="flex min-w-0 flex-col gap-12 rounded-20 border border-line bg-surface p-16 lg:sticky lg:top-80 lg:self-start">
      <h2 className="flex items-baseline justify-between px-4 text-title font-bold">
        Games
        <span className="tabular text-label font-medium text-muted">{entries.length}</span>
      </h2>
      {entries.length === 0 ? (
        <EmptyState icon={Gamepad2} sentence="Games you add show up here with their progress." actionLabel="Add a game" onAction={onFocusInput} className="px-8" />
      ) : (
        <ul className="flex flex-col gap-8">
          {entries.map((entry) => {
            const selected = !adding && entry.id === selectedId
            const status = statuses[entry.id]
            const cover = entry.gallery[0]?.url ?? entry.info.cover
            return (
              <li key={entry.id} className="relative">
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(entry.id)}
                  className={cn('state-layer flex w-full items-center gap-12 rounded-8 border p-8 pr-40 text-left', selected ? 'border-accent bg-raised' : 'border-line')}
                >
                  <ViewTransition name={`game-${entry.id}`} share="game-morph" default="none">
                    <span className="block aspect-video w-96 shrink-0 overflow-hidden rounded-8 bg-raised">
                      {cover && <img src={cover} alt="" width={96} height={54} className="size-full object-cover" />}
                    </span>
                  </ViewTransition>
                  <span className="flex min-w-0 flex-1 flex-col gap-4">
                    <span className="truncate text-label font-medium text-ink">{entry.info.name}</span>
                    <span className={cn('truncate text-micro', status ? toneText[status.tone] : 'text-muted')}>{status?.label ?? 'Starting'}</span>
                    {status?.progress !== undefined && <ProgressBar value={status.progress} tone={status.tone} size="sm" label={`${entry.info.name} progress`} />}
                  </span>
                </button>
                <IconButton label={`Remove ${entry.info.name}`} icon={X} size="sm" onClick={() => onRemove(entry.id)} className="absolute right-4 top-4" />
              </li>
            )
          })}
        </ul>
      )}
      {entries.length > 0 && (
        <button
          type="button"
          aria-label="Add another game"
          onClick={onAdd}
          className={cn(
            'state-layer flex h-40 w-full items-center justify-center gap-8 rounded-8 border border-dashed text-label font-medium',
            adding ? 'border-accent text-accent-ink' : 'border-line-strong text-muted',
          )}
        >
          <Plus aria-hidden className="size-16" />
          Add another game
        </button>
      )}
    </aside>
  )
}
