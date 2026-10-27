import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, Panel, Skeleton, useToast } from '@/components/ui'
import { isDaemonSlug, type DaemonSlug } from '@/data/daemons'
import { toolsBySlug } from '@/data/tools'
import { ApiFailure, deleteDaemon } from '@/lib/api'
import { refreshCredits, useCredits } from '@/lib/credits'
import { fmtInt } from '@/lib/format'
import { refreshKeys } from '@/lib/gemini'
import { useRoute } from '@/lib/router'
import { TOOL_TARGET, type DaemonRecord } from '@/lib/runTypes'
import { AddServerCard } from '@/demo/discord/AddServerCard'
import { ServerHeader } from '@/demo/discord/ServerHeader'
import { TokenDialog } from '@/demo/discord/TokenDialog'
import { FindingsWorkspace } from '@/demo/findings'
import { ThumbnailWorkspace } from '@/demo/thumbnail/ThumbnailWorkspace'
import { AddGameCard } from '@/demo/shell/AddGameCard'
import { DaemonBar } from '@/demo/shell/DaemonBar'
import { GameHeader } from '@/demo/shell/GameHeader'
import { GameRail, type RailItem } from '@/demo/shell/GameRail'
import { KeyDialog } from '@/demo/shell/KeyDialog'
import { TopBar } from '@/demo/shell/TopBar'
import { STATIC_PREVIEW } from '@/lib/static'
import StaticPreview from './StaticPreview'
import { entryIdOf, useDaemonList, useEntries } from '@/demo/shell/useDaemons'
import type { AddCardProps, EntryStatus, TargetEntry, WorkspaceProps } from '@/demo/types'

/* The dashboard at #/demo/<slug>: its own top bar, a main column and a right-hand list. The list is the server's
   daemon list for this tool, so a reload brings every target back. Each entry keeps its workspace mounted (hidden
   when not selected) so a run keeps being followed while the visitor looks at another target. */

export default function Demo({ slug }: { slug: string }) {
  if (!isDaemonSlug(slug)) {
    return (
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 py-48 text-muted">
        There is no tool called {slug}.
      </main>
    )
  }
  if (STATIC_PREVIEW) return <StaticPreview key={slug} slug={slug} />
  return <Dashboard key={slug} slug={slug} />
}

function Dashboard({ slug }: { slug: DaemonSlug }) {
  const tool = toolsBySlug[slug]
  const kind = TOOL_TARGET[slug]
  const noun = kind === 'roblox-game' ? 'game' : 'server'
  const { query } = useRoute()
  const toast = useToast()
  const credits = useCredits(slug)
  const list = useDaemonList(slug, () => void refreshCredits())
  const entries = useEntries(list.daemons)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, EntryStatus>>({})
  const [keysOpen, setKeysOpen] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  /** Runs the user picked from a daemon's history, by entry id. Absent means "follow the latest". */
  const [picked, setPicked] = useState<Record<string, string>>({})
  /** The run id returned when this session started a run, used until the server list shows it. */
  const [hints, setHints] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const reporters = useRef(new Map<string, (s: EntryStatus) => void>())
  // #/demo/<tool>?game=<link or id> only prefills the input once. It never submits by itself.
  const [initialLink, setInitialLink] = useState(() => query.get('game') ?? '')

  const daemons = list.daemons
  const items: RailItem[] = useMemo(
    () =>
      (daemons ?? []).map((d) => {
        const id = entryIdOf(d)
        const entry = entries.byId[id]
        const image = entry?.kind === 'roblox-game' ? (entry.gallery[0]?.url ?? entry.info.cover ?? d.image) : d.image
        return { id, name: d.title, image, daemon: d }
      }),
    [daemons, entries.byId],
  )
  const loading = daemons === null && !list.failed
  const showCard = adding || (!loading && items.length === 0 && !list.failed)

  // Keep a valid selection: the first target once the list arrives, a neighbour after a removal.
  useEffect(() => {
    if (items.length === 0) return
    if (!selectedId || !items.some((i) => i.id === selectedId)) setSelectedId(items[0].id)
  }, [items, selectedId])

  const onChanged = useCallback(() => {
    void refreshCredits()
    void refreshKeys()
    void list.refresh()
  }, [list])

  const topUp = useCallback(async () => {
    const res = await credits.topUp()
    if (res) toast.push({ title: `${fmtInt(res.added)} credits added`, description: `${tool.name} now has ${fmtInt(res.balance)}.`, tone: 'ok' })
    else toast.push({ title: 'Credits could not be added', description: 'The local server did not answer. Try again.', tone: 'danger' })
  }, [credits, toast, tool.name])

  const addEntry = useCallback(
    (entry: TargetEntry, runId: string, daemon?: DaemonRecord) => {
      entries.adopt(entry)
      if (daemon) list.upsert(daemon)
      else void list.refresh()
      setHints((h) => ({ ...h, [entry.id]: runId }))
      setPicked((p) => {
        const { [entry.id]: _gone, ...rest } = p
        return rest
      })
      setSelectedId(entry.id)
      setAdding(false)
      setInitialLink('')
      void refreshCredits()
    },
    [entries, list],
  )

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

  const confirmRemove = async () => {
    const item = items.find((i) => i.id === removing)
    if (!item) return
    setRemoveBusy(true)
    try {
      await deleteDaemon(item.daemon.id)
    } catch (err) {
      setRemoveBusy(false)
      toast.push({ title: `${item.name} could not be removed`, description: err instanceof ApiFailure ? err.message : 'Try again.', tone: 'danger' })
      return
    }
    setRemoveBusy(false)
    reporters.current.delete(item.id)
    const rest = items.filter((i) => i.id !== item.id)
    startTransition(() => {
      list.drop(item.daemon.id)
      setStatuses((s) => {
        const { [item.id]: _gone, ...others } = s
        return others
      })
      if (selectedId === item.id) setSelectedId(rest[rest.length - 1]?.id ?? null)
      setRemoving(null)
    })
    toast.push({ title: `${item.name} removed`, description: 'Its reruns stopped and its saved runs were deleted.', tone: 'info' })
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

  const addProps: AddCardProps = {
    slug,
    balance: credits.balance,
    existingIds: items.map((i) => i.id),
    inputRef,
    initialLink,
    focusOnMount: adding,
    onAdd: addEntry,
    onExisting: selectExisting,
    onTopUp: () => void topUp(),
  }
  const Workspace = slug === 'thumbnail-daemon' ? ThumbnailWorkspace : FindingsWorkspace
  const removingItem = items.find((i) => i.id === removing)

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar slug={slug} balance={credits.balance} loading={credits.loading} onTopUp={() => void topUp()} onOpenKeys={() => setKeysOpen(true)} />
      <div id="main-content" tabIndex={-1} className="mx-auto flex max-w-page flex-col gap-24 px-16 py-24 sm:px-24 lg:flex-row">
        <div className="order-2 min-w-0 flex-1 lg:order-1">
          {loading && (
            <div aria-busy aria-label="Loading your list" className="flex flex-col gap-24">
              <Skeleton className="h-240 w-full rounded-20" />
              <Skeleton className="h-120 w-full rounded-20" />
            </div>
          )}
          {list.failed && !showCard && (
            <Panel bodyClassName="flex flex-col items-start gap-12 p-24">
              <p className="text-label text-muted">The list of your {noun}s did not load. The local server may not be running.</p>
              <Button onClick={() => void list.refresh()}>Retry</Button>
            </Panel>
          )}
          {showCard && <div>{kind === 'roblox-game' ? <AddGameCard {...addProps} /> : <AddServerCard {...addProps} />}</div>}
          {items.map((item) => {
            const entry = entries.byId[item.id]
            const selected = !showCard && item.id === selectedId
            const error = entries.errors[item.id]
            const d = item.daemon
            const runId = picked[item.id] ?? d.activeRunId ?? d.last?.runId ?? hints[item.id] ?? null
            const props: WorkspaceProps | null = entry
              ? {
                  slug,
                  entry,
                  daemon: d,
                  runId,
                  active: selected,
                  report: reporterFor(item.id),
                  onChanged,
                  openKeyDialog: () => setKeysOpen(true),
                  openDiscordToken: () => setTokenOpen(true),
                }
              : null
            return (
              <div key={item.id} hidden={!selected} className="flex flex-col gap-24 motion-safe:animate-enter">
                {entry ? (
                  entry.kind === 'roblox-game' ? <GameHeader entry={entry} /> : <ServerHeader entry={entry} />
                ) : error ? (
                  <Panel bodyClassName="flex flex-col items-start gap-12 p-24">
                    <h1 className="text-headline text-ink break-words">{item.name}</h1>
                    <p className="text-label text-muted">{error}</p>
                    <Button onClick={() => entries.retry(item.id)}>Retry</Button>
                  </Panel>
                ) : (
                  <Skeleton className="h-240 w-full rounded-20" />
                )}
                <DaemonBar
                  slug={slug}
                  daemon={d}
                  credits={credits}
                  viewingRunId={picked[item.id] ?? null}
                  onPickRun={(id) =>
                    setPicked((p) => {
                      if (id) return { ...p, [item.id]: id }
                      const { [item.id]: _gone, ...rest } = p
                      return rest
                    })
                  }
                  onUpdated={list.upsert}
                  onRunStarted={(id) => {
                    setHints((h) => ({ ...h, [item.id]: id }))
                    setPicked((p) => {
                      const { [item.id]: _gone, ...rest } = p
                      return rest
                    })
                    onChanged()
                  }}
                  onRemove={() => setRemoving(item.id)}
                  onTopUp={() => void topUp()}
                />
                {props && <Workspace {...props} />}
              </div>
            )
          })}
        </div>
        <div className={items.length === 0 && !loading && !list.failed ? 'order-1 hidden lg:order-2 lg:block lg:w-320 lg:shrink-0' : 'order-1 lg:order-2 lg:w-320 lg:shrink-0'}>
          <GameRail
            items={items}
            statuses={statuses}
            selectedId={selectedId}
            adding={showCard}
            loading={loading}
            failed={list.failed}
            noun={noun}
            onSelect={(id) =>
              startTransition(() => {
                setSelectedId(id)
                setAdding(false)
              })
            }
            onRemove={setRemoving}
            onAdd={focusInput}
            onRetry={() => void list.refresh()}
          />
        </div>
      </div>
      <KeyDialog open={keysOpen} onOpenChange={setKeysOpen} onChanged={onChanged} openDiscordToken={() => setTokenOpen(true)} />
      <TokenDialog
        open={tokenOpen}
        onOpenChange={setTokenOpen}
        onSaved={() => {
          setTokenOpen(false)
          onChanged()
        }}
      />
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && !removeBusy && setRemoving(null)}
        title={removingItem ? `Remove ${removingItem.name}?` : 'Remove this target?'}
        description="Its scheduled reruns stop and its saved runs are deleted from this machine. Credits already spent are not refunded."
        footer={
          <>
            <Button onClick={() => setRemoving(null)} disabled={removeBusy}>
              Keep it
            </Button>
            <Button variant="danger" loading={removeBusy} onClick={() => void confirmRemove()}>
              Remove
            </Button>
          </>
        }
      />
    </div>
  )
}
