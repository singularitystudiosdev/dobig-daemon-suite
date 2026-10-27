import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtInt } from '@/lib/format'
import { useOnClickOutside } from '@/lib/hooks'
import { games } from '@/data/games'
import { useActiveGame } from '@/context/ActiveGame'
import { GameThumb } from '@/components/ui'

/* Which of your games the daemon is attached to. Shared across all six daemons. */
export function GamePicker() {
  const { game, setGameId } = useActiveGame()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOnClickOutside(ref, () => setOpen(false), open)

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="state-layer flex h-56 items-center gap-12 rounded-8 border border-line bg-raised pl-8 pr-12 text-left"
      >
        <GameThumb game={game} size={40} />
        <span className="flex min-w-0 flex-col">
          <span className="text-micro text-muted">Attached to</span>
          <span className="w-160 truncate text-label font-medium text-ink">{game.shortName}</span>
        </span>
        <ChevronDown aria-hidden className={cn('size-16 text-muted transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Choose a game"
          className="scroll-thin absolute right-0 top-full z-30 mt-8 max-h-440 w-340 overflow-y-auto rounded-8 border border-line bg-surface p-4 shadow-28 motion-safe:animate-enter"
        >
          {games.map((g) => {
            const selected = g.id === game.id
            return (
              <li key={g.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    setGameId(g.id)
                    setOpen(false)
                  }}
                  className={cn('state-layer flex w-full items-center gap-12 rounded-8 px-8 py-8 text-left', selected ? 'text-ink' : 'text-ink')}
                >
                  <GameThumb game={g} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-label font-medium">{g.name}</span>
                    <span className="text-micro text-muted">
                      <span className="tabular font-bold text-live">{fmtInt(g.playing)}</span> playing
                    </span>
                  </span>
                  {selected && <Check aria-hidden className="size-16 text-accent-ink" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
