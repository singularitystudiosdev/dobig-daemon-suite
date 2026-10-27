import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { CircleAlert, Download, Images, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import { Badge, Button, Dialog, EmptyState, Panel, ProgressBar, useToast } from '@/components/ui'
import { CREDITS_PER_VARIANT } from '@/data/tools'
import { runDaemonNow } from '@/lib/api'
import { navigate } from '@/lib/router'
import { PROVIDER_NAME } from '@/lib/gemini'
import { VARIANT_PROMPT, VARIANTS_PER_THUMB, type GalleryThumb, type VariantEvent, type VariantRequest } from '@/lib/apiTypes'
import { fmtInt, timeAgo } from '@/lib/format'
import type { ThumbnailDetail } from '@/lib/details/thumbnail'
import { isEnded, useRun, type RunState } from '../findings/runState'
import type { GameEntry, WorkspaceProps } from '../types'
import { INITIAL_TILES, tileKey, tilesReducer, type Tile } from './state'
import { fetchExistingVariants, postVariants } from './variantsClient'
import { OriginalFrame, VariantFrame } from './VariantFrame'

/* Thumbnail Daemon workspace. Credits are charged by the server in POST /api/variants; this file never spends or
   refunds. It generates ONLY when the user asks: on mount only for a game the user just added (entry.autoRun),
   otherwise it shows outputs generated earlier (read-only) with a button to generate. The daemon is a free gallery
   watcher; its latest run is followed here to say whether the gallery has new thumbnails. */

const MODEL_NAME = 'Nano Banana 2.1'
const MAX_THUMBS = 12
const INDEXES = Array.from({ length: VARIANTS_PER_THUMB }, (_, i) => i)

/** Entries the workspace already started for in this page session, so a remount never charges twice. */
const autoStarted = new Set<string>()

interface Zoom {
  thumbId: string
  index: number
}

interface Scope {
  thumbs: GalleryThumb[]
  only?: { thumbId: string; index: number }[]
}

type Banner = { kind: 'credits'; needed: number; balance: number } | { kind: 'error'; message: string } | null

interface WatchedThumb extends GalleryThumb {
  isNew: boolean
  position: number
}

function extOf(src: string) {
  const m = /\.(png|jpe?g|webp)(?:\?|$)/i.exec(src)
  return m ? `.${m[1].toLowerCase()}` : ''
}

/** The gallery as the watcher last read it, in gallery order. Empty until a watcher run has finished. */
function watchedThumbs(run: RunState): WatchedThumb[] {
  if (!run.end || run.end.status !== 'done') return []
  const out: WatchedThumb[] = []
  for (const f of run.findings) {
    if (f.detail.kind !== 'thumbnail') continue
    const d: ThumbnailDetail = f.detail
    out.push({ id: d.thumbId, url: d.url, isNew: d.isNew, position: d.position })
  }
  return out.sort((a, b) => a.position - b.position)
}

export function ThumbnailWorkspace(props: WorkspaceProps) {
  const { entry } = props
  if (entry.kind !== 'roblox-game') {
    return <EmptyState icon={Images} sentence="The Thumbnail Daemon works on Roblox games." actionLabel="Read how it works" onAction={() => navigate('/t/thumbnail-daemon', 'forward')} />
  }
  return <Workspace {...props} entry={entry} />
}

function Workspace({ entry, daemon, runId, report, onChanged, openKeyDialog }: WorkspaceProps & { entry: GameEntry }) {
  const { state: watch } = useRun(runId)
  const watched = useMemo(() => watchedThumbs(watch), [watch])
  const thumbs: GalleryThumb[] = useMemo(() => (watched.length > 0 ? watched : entry.gallery).slice(0, MAX_THUMBS), [watched, entry.gallery])
  const newOnes = useMemo(() => watched.filter((t) => t.isNew), [watched])
  const newIds = useMemo(() => new Set(newOnes.map((t) => t.id)), [newOnes])

  const [state, dispatch] = useReducer(tilesReducer, INITIAL_TILES)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const [banner, setBanner] = useState<Banner>(null)
  const [submitting, setSubmitting] = useState(false)
  const [earlier, setEarlier] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [lastScope, setLastScope] = useState<Scope | null>(null)
  const controllers = useRef(new Set<AbortController>())
  const generated = useRef(false)
  const toast = useToast()
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged

  const total = thumbs.length * VARIANTS_PER_THUMB
  const allKeys = useMemo(() => thumbs.flatMap((t) => INDEXES.map((i) => tileKey(t.id, i))), [thumbs])

  const run = useCallback(async (scope: Scope) => {
    const ac = new AbortController()
    controllers.current.add(ac)
    generated.current = true
    setLastScope(scope)
    setBanner(null)
    setSubmitting(true)
    const keys = scope.only ? scope.only.map((o) => tileKey(o.thumbId, o.index)) : scope.thumbs.flatMap((t) => INDEXES.map((i) => tileKey(t.id, i)))
    const pending = new Set(keys)
    const request: VariantRequest = { gallery: scope.thumbs, perThumb: VARIANTS_PER_THUMB }
    if (scope.only) request.only = scope.only
    let unavailable = false

    const onEvent = (e: VariantEvent) => {
      if (ac.signal.aborted) return
      if (e.type === 'start') {
        setSubmitting(false)
        if (e.mode === 'unavailable') {
          unavailable = true
          ac.abort()
          dispatch({ type: 'unavailable' })
          return
        }
        dispatch({ type: 'queue', keys })
      }
      if (e.type === 'done' || e.type === 'failed') pending.delete(tileKey(e.thumbId, e.index))
      dispatch({ type: 'event', event: e })
    }

    const outcome = await postVariants(request, onEvent, ac.signal)
    controllers.current.delete(ac)
    setSubmitting(false)
    if (outcome.kind === 'credits') setBanner({ kind: 'credits', needed: outcome.needed, balance: outcome.balance })
    else if (outcome.kind === 'error') {
      const leftover = [...pending]
      if (leftover.length > 0) dispatch({ type: 'fail', keys: leftover, reason: 'upstream', message: outcome.message })
      else setBanner({ kind: 'error', message: outcome.message })
    } else if (outcome.kind === 'streamed') {
      const leftover = [...pending]
      if (leftover.length > 0) dispatch({ type: 'fail', keys: leftover, reason: 'upstream', message: 'The stream closed before this variant finished.' })
    }
    // Credits are charged and refunded by the server; the shell re-reads them after every stream call.
    if (outcome.kind !== 'aborted' || unavailable) onChangedRef.current()
  }, [])

  // Generate on mount ONLY for a game the user just added by pressing the button. The timer lets a StrictMode remount
  // cancel the first start before any request is made.
  useEffect(() => {
    if (!entry.autoRun || autoStarted.has(entry.id)) return
    const t = window.setTimeout(() => {
      autoStarted.add(entry.id)
      void run({ thumbs: entry.gallery.slice(0, MAX_THUMBS) })
    }, 0)
    return () => window.clearTimeout(t)
  }, [entry.autoRun, entry.id, entry.gallery, run])

  useEffect(() => {
    const live = controllers.current
    return () => {
      live.forEach((c) => c.abort())
      live.clear()
    }
  }, [])

  // Otherwise show what was generated earlier. This lookup never generates and never charges.
  const idsKey = thumbs.map((t) => t.id).join(',')
  const lookedUp = useRef('')
  useEffect(() => {
    if (!idsKey || entry.autoRun || generated.current || lookedUp.current === idsKey) return
    const ac = new AbortController()
    setEarlier('loading')
    fetchExistingVariants(thumbs, ac.signal)
      .then((items) => {
        if (ac.signal.aborted) return
        lookedUp.current = idsKey
        dispatch({ type: 'existing', items })
        setEarlier('ready')
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return
        setEarlier('error')
        toast.push({ title: 'Could not load earlier outputs', description: err instanceof Error ? err.message : 'Try again in a moment.', tone: 'warn' })
      })
    return () => ac.abort()
    // thumbs is derived from idsKey; the lookup only depends on the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, entry.autoRun])

  const counts = useMemo(() => {
    let done = 0
    let failed = 0
    let working = 0
    let queued = 0
    let earlierDone = 0
    for (const k of allKeys) {
      const t = state.tiles[k]
      if (!t) continue
      if (t.status === 'done') {
        done += 1
        if (t.earlier) earlierDone += 1
      } else if (t.status === 'failed') failed += 1
      else if (t.status === 'working') working += 1
      else queued += 1
    }
    return { done, failed, working, queued, earlierDone, pending: working + queued }
  }, [allKeys, state.tiles])
  const running = !state.unavailable && counts.pending > 0
  const finished = counts.done + counts.failed - counts.earlierDone
  const starting = running && counts.working === 0 && finished === 0

  useEffect(() => {
    if (state.unavailable) report({ label: 'Needs an image key', tone: 'warn' })
    else if (banner?.kind === 'credits') report({ label: `Needs ${fmtInt(banner.needed)} credits`, tone: 'warn' })
    else if (running) report({ label: starting ? 'Starting' : `Generating ${finished} of ${counts.pending + finished}`, tone: 'accent', progress: counts.pending + finished ? finished / (counts.pending + finished) : 0 })
    else if (submitting) report({ label: 'Starting', tone: 'accent' })
    else if (counts.failed > 0) report({ label: `${counts.failed} failed`, tone: 'danger' })
    else if (counts.done > 0) report({ label: counts.earlierDone === counts.done ? `${counts.done} earlier variants` : `${counts.done} variants ready`, tone: counts.earlierDone === counts.done ? 'muted' : 'live' })
    else report({ label: earlier === 'loading' ? 'Looking for earlier outputs' : 'Ready to generate', tone: 'muted' })
  }, [state.unavailable, banner, running, starting, submitting, finished, counts, earlier, report])

  const missing = useMemo(() => {
    const out: { thumbId: string; index: number }[] = []
    for (const t of thumbs) for (const i of INDEXES) {
      const tile = state.tiles[tileKey(t.id, i)]
      if (!tile || tile.status === 'failed') out.push({ thumbId: t.id, index: i })
    }
    return out
  }, [thumbs, state.tiles])

  const busy = running || submitting
  const generateMissing = () => {
    const ids = new Set(missing.map((m) => m.thumbId))
    const scoped = thumbs.filter((t) => ids.has(t.id))
    void run(missing.length === total ? { thumbs } : { thumbs: scoped, only: missing })
  }
  const regenerateAll = () => void run({ thumbs })
  const retry = (thumbId: string, index: number) => {
    const thumb = thumbs.find((t) => t.id === thumbId)
    if (thumb) void run({ thumbs: [thumb], only: [{ thumbId, index }] })
  }
  const generateForNew = () => {
    const todo = newOnes.flatMap((t) => INDEXES.filter((i) => state.tiles[tileKey(t.id, i)]?.status !== 'done' || state.tiles[tileKey(t.id, i)]?.earlier).map((i) => ({ thumbId: t.id, index: i })))
    if (todo.length > 0) void run({ thumbs: newOnes, only: todo })
  }
  const addCredits = () => {
    window.scrollTo({ top: 0 })
    toast.push({ title: 'Add credits from the top bar', description: 'Then press Generate variants again.', tone: 'info' })
    onChanged()
  }
  const checkAgain = () => {
    runDaemonNow(daemon.id)
      .then(() => onChanged())
      .catch((err: unknown) => toast.push({ title: 'Could not start the check', description: err instanceof Error ? err.message : 'Try again in a moment.', tone: 'danger' }))
  }

  if (total === 0) {
    return <EmptyState icon={Images} sentence="This game has no gallery thumbnails to vary." actionLabel="Read how it works" onAction={() => navigate('/t/thumbnail-daemon', 'forward')} />
  }

  if (state.unavailable) {
    return (
      <Panel title="Generating for this game needs an image key">
        <div className="flex flex-col gap-16">
          <p className="max-w-prose text-body text-muted">
            {MODEL_NAME} makes each variant live when you ask. Nothing is pre-made or stored. It needs a Gemini or OpenRouter key on this server. Your credits for this run were returned.
          </p>
          <div className="flex flex-wrap gap-8">
            <Button variant="primary" onClick={openKeyDialog}>
              Add a key
            </Button>
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={() => {
                dispatch({ type: 'restart' })
                if (lastScope) void run(lastScope)
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      </Panel>
    )
  }

  const live = state.mode === 'live'
  const anyDone = counts.done > 0
  const zoomThumb = zoom ? thumbs.find((t) => t.id === zoom.thumbId) : undefined
  const zoomTile = zoom ? state.tiles[tileKey(zoom.thumbId, zoom.index)] : undefined
  const zoomN = zoom ? thumbs.findIndex((t) => t.id === zoom.thumbId) + 1 : 0
  const missingCost = missing.length * CREDITS_PER_VARIANT

  return (
    <Panel
      title="Variants"
      actions={
        <>
          {live && running && (
            <Badge tone="live" dot>
              {state.provider ? `Live, ${PROVIDER_NAME[state.provider]}` : 'Live'}
            </Badge>
          )}
          {!busy && missing.length > 0 && (
            <>
              <span className="tabular text-label text-muted">
                {missing.length} variants, {fmtInt(missingCost)} credits
              </span>
              <Button variant="primary" icon={Sparkles} onClick={generateMissing}>
                Generate variants
              </Button>
            </>
          )}
          {!busy && anyDone && (
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={regenerateAll} title={`${fmtInt(total * CREDITS_PER_VARIANT)} credits`}>
              Regenerate all
            </Button>
          )}
          {busy && !running && <LoaderCircle aria-label="Starting" role="img" className="size-20 text-accent-ink motion-safe:animate-spin" />}
        </>
      }
    >
      <div className="flex flex-col gap-24">
        <GalleryWatch run={watch} runId={runId} newCount={newOnes.length} total={watched.length} baseline={daemon.runs <= 1} lastRunAt={daemon.lastRunAt} generatedForNew={newOnes.length > 0 && newOnes.every((t) => INDEXES.every((i) => state.tiles[tileKey(t.id, i)]?.status === 'done' && !state.tiles[tileKey(t.id, i)]?.earlier))} busy={busy} onGenerate={generateForNew} onCheckAgain={checkAgain} />

        {banner?.kind === 'credits' && (
          <div role="alert" className="flex flex-wrap items-center gap-x-16 gap-y-12 rounded-8 border border-line bg-raised px-16 py-12">
            <CircleAlert aria-hidden className="size-16 shrink-0 text-warn" />
            <p className="tabular min-w-0 flex-1 basis-240 text-label text-ink">
              This run needs {fmtInt(banner.needed)} credits, you have {fmtInt(banner.balance)}.
            </p>
            <Button size="sm" variant="primary" onClick={addCredits}>
              Add credits
            </Button>
          </div>
        )}
        {banner?.kind === 'error' && (
          <div role="alert" className="flex flex-wrap items-center gap-x-16 gap-y-12 rounded-8 border border-line bg-raised px-16 py-12">
            <CircleAlert aria-hidden className="size-16 shrink-0 text-danger" />
            <p className="min-w-0 flex-1 basis-240 text-label text-ink">{banner.message}</p>
          </div>
        )}

        <div className="flex flex-col gap-8">
          <p className="tabular text-body text-ink">
            {total} variants from {thumbs.length} {thumbs.length === 1 ? 'thumbnail' : 'thumbnails'}, {VARIANTS_PER_THUMB} each. <span className="text-muted">{MODEL_NAME}</span>
          </p>
          <p className="text-label text-muted">Prompt: &ldquo;{VARIANT_PROMPT}&rdquo; with the thumbnail attached.</p>
          {counts.earlierDone > 0 && !running && <p className="text-label text-muted">Showing outputs generated earlier. Nothing new is generated, or charged, until you press a button.</p>}
          {earlier === 'loading' && (
            <p role="status" className="text-label text-muted">
              Looking for outputs generated earlier.
            </p>
          )}
          {running && (
            <div className="flex items-center gap-12" role="status">
              <span className="tabular shrink-0 text-label text-accent-ink">{starting ? 'Starting' : `Generating ${finished} of ${counts.pending + finished}`}</span>
              <ProgressBar value={counts.pending + finished ? finished / (counts.pending + finished) : 0} size="sm" label="Variants finished" className="flex-1" />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          {thumbs.map((thumb, row) => (
            <section key={thumb.id} aria-label={`Thumbnail ${row + 1} of ${thumbs.length}`} className="grid grid-cols-2 gap-12 border-t border-line py-16 first:border-t-0 first:pt-0 last:pb-0 xl:grid-cols-4">
              <OriginalFrame url={thumb.url} alt={`Original thumbnail ${row + 1}`} isNew={newIds.has(thumb.id)} />
              {INDEXES.map((i) => {
                const tile: Tile | { status: 'idle' } = state.tiles[tileKey(thumb.id, i)] ?? { status: 'idle' }
                return (
                  <VariantFrame
                    key={i}
                    tile={tile}
                    label={`Variant ${i + 1}`}
                    name={`Thumbnail ${row + 1}, variant ${i + 1}`}
                    downloadName={`${entry.id}-${thumb.id}-variant-${i + 1}${extOf('src' in tile ? (tile.src ?? '') : '')}`}
                    onOpen={() => setZoom({ thumbId: thumb.id, index: i })}
                    onRetry={() => retry(thumb.id, i)}
                    onAddKey={openKeyDialog}
                  />
                )
              })}
            </section>
          ))}
        </div>
      </div>

      <Dialog
        open={zoom !== null}
        onOpenChange={(o) => !o && setZoom(null)}
        title={`Thumbnail ${zoomN}, variant ${zoom ? zoom.index + 1 : ''}`}
        description={`The original on the left, the ${MODEL_NAME} variant on the right.`}
        className="w-1040"
        footer={
          zoomTile?.src ? (
            <a
              href={zoomTile.src}
              download={`${entry.id}-${zoom?.thumbId}-variant-${(zoom?.index ?? 0) + 1}${extOf(zoomTile.src)}`}
              className="state-layer inline-flex h-40 items-center gap-8 rounded-8 border border-line bg-raised px-16 text-label font-medium text-ink"
            >
              <Download aria-hidden className="size-16" />
              Download variant
            </a>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2">
          {zoomThumb && <img src={zoomThumb.url} alt={`Original thumbnail ${zoomN}`} className="aspect-video w-full rounded-8 bg-raised object-cover" />}
          {zoomTile?.src && <img src={zoomTile.src} alt={`Variant ${zoom ? zoom.index + 1 : ''} of thumbnail ${zoomN}`} className="aspect-video w-full rounded-8 bg-raised object-cover" />}
        </div>
      </Dialog>
    </Panel>
  )
}

/* What the free gallery watcher found on its latest check. It never generates; the button asks for variants of only
   the new thumbnails, which the server charges when the user presses it. */
function GalleryWatch({
  run,
  runId,
  newCount,
  total,
  baseline,
  lastRunAt,
  generatedForNew,
  busy,
  onGenerate,
  onCheckAgain,
}: {
  run: RunState
  runId: string | null
  newCount: number
  total: number
  baseline: boolean
  lastRunAt?: string
  generatedForNew: boolean
  busy: boolean
  onGenerate: () => void
  onCheckAgain: () => void
}) {
  if (!runId) return null
  const quiet = 'text-label text-muted'
  if (run.error) {
    return (
      <div className="flex flex-wrap items-center gap-x-12 gap-y-8">
        <p className={quiet}>The gallery check did not finish: {run.error.message}</p>
        <Button variant="ghost" size="sm" onClick={onCheckAgain}>
          Check again
        </Button>
      </div>
    )
  }
  if (!isEnded(run)) {
    return (
      <p role="status" className={`${quiet} inline-flex items-center gap-8`}>
        <LoaderCircle aria-hidden className="size-16 shrink-0 text-accent-ink motion-safe:animate-spin" />
        Checking the gallery for changes
      </p>
    )
  }
  if (run.end?.status !== 'done') return null
  if (baseline) return <p className={quiet}>{`Watching ${total} gallery ${total === 1 ? 'thumbnail' : 'thumbnails'}. New ones are flagged here after the next check.`}</p>
  if (newCount > 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-16 gap-y-12 rounded-8 border border-accent-ink bg-accent-soft px-16 py-12">
        <p role="status" className="tabular min-w-0 flex-1 basis-240 text-label text-ink">
          {newCount} new {newCount === 1 ? 'thumbnail' : 'thumbnails'} since the last check
        </p>
        {generatedForNew ? (
          <span className="text-label text-muted">Variants generated for the new ones</span>
        ) : (
          <Button size="sm" variant="primary" disabled={busy} onClick={onGenerate}>
            Generate variants for the new ones
          </Button>
        )}
      </div>
    )
  }
  const at = lastRunAt ?? (run.startedAt !== null ? new Date(run.startedAt).toISOString() : null)
  return <p className={quiet}>{at ? `Gallery checked ${timeAgo(at, new Date())}, no changes.` : 'Gallery checked, no changes.'}</p>
}
