import { startTransition, useCallback, useRef, useState } from 'react'
import { isDaemonSlug } from '@/data/daemons'
import { toolsBySlug } from '@/data/tools'
import { useCredits } from '@/lib/credits'
import { useRoute } from '@/lib/router'
import { useToast } from '@/components/ui'
import { FindingsWorkspace } from '@/demo/findings'
import { ThumbnailWorkspace } from '@/demo/thumbnail/ThumbnailWorkspace'
import { AddGameCard } from '@/demo/shell/AddGameCard'
import { GameHeader } from '@/demo/shell/GameHeader'
import { GameRail } from '@/demo/shell/GameRail'
import { GeminiDialog } from '@/demo/shell/GeminiDialog'
import { TopBar } from '@/demo/shell/TopBar'
import type { EntryStatus, GameEntry } from '@/demo/types'
import type { DaemonSlug } from '@/data/daemons'

/* The demo dashboard at #/demo/<slug>: its own top bar, a main column and a right rail of games.
   Every added game keeps its workspace mounted (hidden when not selected) so generation continues in the
   background while the visitor adds another game. */

export default function Demo({ slug }: { slug: string }) {
  if (!isDaemonSlug(slug)) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 py-48 text-muted">
        There is no tool called {slug}.
      </main>
    )
  }
  return <Dashboard key={slug} slug={slug} />
}

function Dashboard({ slug }: { slug: DaemonSlug }) {
  const tool = toolsBySlug[slug]
  const { query } = useRoute()
  const toast = useToast()
  const credits = useCredits(slug)
  const [entries, setEntries] = useState<GameEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, EntryStatus>>({})
  const [geminiOpen, setGeminiOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const reporters = useRef(new Map<string, (s: EntryStatus) => void>())
  // #/demo/<tool>?game=<link or id> only prefills the input once. It never submits by itself.
  const [initialLink, setInitialLink] = useState(() => query.get('game') ?? '')

  const showCard = adding || entries.length === 0

  const topUp = useCallback(() => {
    const added = credits.topUp()
    toast.push({ title: `${added} credits added`, description: `${tool.name} now has more to spend. This is a mock top-up.`, tone: 'ok' })
  }, [credits, toast, tool.name])

  const addEntry = useCallback((entry: GameEntry) => {
    setEntries((list) => (list.some((e) => e.id === entry.id) ? list : [...list, entry]))
    setSelectedId(entry.id)
    setAdding(false)
    setInitialLink('')
  }, [])

  const selectExisting = useCallback(
    (id: string) => {
      toast.push({ title: 'Already in your list', description: 'Opened it instead, nothing was charged.', tone: 'info' })
      startTransition(() => {
        setSelectedId(id)
        setAdding(false)
      })
    },
    [toast],
  )

  const removeEntry = (id: string) => {
    reporters.current.delete(id)
    const rest = entries.filter((e) => e.id !== id)
    startTransition(() => {
      setEntries(rest)
      setStatuses((s) => {
        const { [id]: _gone, ...others } = s
        return others
      })
      if (selectedId === id) setSelectedId(rest[rest.length - 1]?.id ?? null)
    })
  }

  const reporterFor = (id: string) => {
    let fn = reporters.current.get(id)
    if (!fn) {
      fn = (status) =>
        setStatuses((s) => {
          const prev = s[id]
          if (prev && prev.label === status.label && prev.tone === status.tone && prev.progress === status.progress) return s
          return { ...s, [id]: status }
        })
      reporters.current.set(id, fn)
    }
    return fn
  }

  const focusInput = () => {
    setAdding(true)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const Workspace = slug === 'thumbnail-daemon' ? ThumbnailWorkspace : FindingsWorkspace

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar slug={slug} balance={credits.balance} onTopUp={topUp} onOpenGemini={() => setGeminiOpen(true)} />
      <div id="main-content" tabIndex={-1} className="mx-auto flex max-w-page flex-col gap-24 px-16 py-24 sm:px-24 lg:flex-row">
        <div className="order-2 min-w-0 flex-1 lg:order-1">
          {showCard && (
            <div>
              <AddGameCard
                slug={slug}
                balance={credits.balance}
                existingIds={entries.map((e) => e.id)}
                inputRef={inputRef}
                initialLink={initialLink}
                focusOnMount={adding}
                spend={credits.spend}
                onTopUp={topUp}
                onAdd={addEntry}
                onExisting={selectExisting}
              />
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} hidden={showCard || entry.id !== selectedId} className="flex flex-col gap-24 motion-safe:animate-enter">
              <GameHeader entry={entry} />
              <Workspace
                slug={slug}
                entry={entry}
                active={!showCard && entry.id === selectedId}
                refund={credits.refund}
                charge={credits.spend}
                openGemini={() => setGeminiOpen(true)}
                report={reporterFor(entry.id)}
              />
            </div>
          ))}
        </div>
        <div className={entries.length === 0 ? 'order-1 hidden lg:order-2 lg:block lg:w-320 lg:shrink-0' : 'order-1 lg:order-2 lg:w-320 lg:shrink-0'}>
          <GameRail
            entries={entries}
            statuses={statuses}
            selectedId={selectedId}
            adding={showCard}
            onSelect={(id) =>
              startTransition(() => {
                setSelectedId(id)
                setAdding(false)
              })
            }
            onRemove={removeEntry}
            onAdd={focusInput}
            onFocusInput={focusInput}
          />
        </div>
      </div>
      <GeminiDialog open={geminiOpen} onOpenChange={setGeminiOpen} />
    </div>
  )
}
