import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Download, Images, RefreshCw } from 'lucide-react'
import { Badge, Button, Dialog, EmptyState, Panel, ProgressBar, useToast } from '@/components/ui'
import { navigate } from '@/lib/router'
import { streamVariants } from '@/lib/api'
import { readGeminiKey, useGeminiKey } from '@/lib/gemini'
import { VARIANT_PROMPT, VARIANTS_PER_THUMB, type VariantEvent, type VariantRequest } from '@/lib/apiTypes'
import type { WorkspaceProps } from '../types'
import { initTiles, tileKey, tilesReducer } from './state'
import { OriginalFrame, VariantFrame } from './VariantFrame'

/* Thumbnail Daemon workspace. On mount it streams /api/variants for every gallery thumbnail, three variants
   each, and renders one row per thumbnail: the original, then three variant frames that start as shimmering
   pending frames and resolve one by one as their images arrive. */

const COST_PER_VARIANT_USD = 0.034
const MODEL_NAME = 'Nano Banana 2.1'

interface Zoom {
  thumbId: string
  index: number
}

function extOf(src: string) {
  const m = /\.(png|jpe?g|webp)(?:\?|$)/i.exec(src)
  return m ? `.${m[1].toLowerCase()}` : ''
}

export function ThumbnailWorkspace({ entry, refund, charge: chargeProp, report, openGemini }: WorkspaceProps) {
  const charge = chargeProp ?? (() => true)
  const thumbs = entry.gallery
  const total = thumbs.length * VARIANTS_PER_THUMB
  const allKeys = useMemo(() => thumbs.flatMap((t) => Array.from({ length: VARIANTS_PER_THUMB }, (_, i) => tileKey(t.id, i))), [thumbs])
  const [state, dispatch] = useReducer(tilesReducer, allKeys, initTiles)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const controllers = useRef(new Set<AbortController>())
  const geminiKey = useGeminiKey()
  const toast = useToast()

  const run = useCallback(
    (opts: { initial: boolean; only?: { thumbId: string; index: number }[] }) => {
      const ac = new AbortController()
      controllers.current.add(ac)
      const scope = opts.only ? opts.only.map((o) => tileKey(o.thumbId, o.index)) : allKeys
      const pending = new Set(scope)
      dispatch({ type: 'queue', keys: scope })
      const request: VariantRequest = { gallery: entry.gallery, perThumb: VARIANTS_PER_THUMB }
      if (opts.only) request.only = opts.only
      let failedSeen = 0
      let unavailable = false

      const onEvent = (e: VariantEvent) => {
        if (ac.signal.aborted) return
        if (e.type === 'start' && e.mode === 'unavailable') {
          unavailable = true
          ac.abort()
          refund(scope.length)
          if (opts.initial) dispatch({ type: 'unavailable' })
          else dispatch({ type: 'fail', keys: scope, reason: 'no-key', message: 'Add a Gemini API key to generate this thumbnail.' })
          return
        }
        if (e.type === 'done' || e.type === 'failed') {
          pending.delete(tileKey(e.thumbId, e.index))
          if (e.type === 'failed') failedSeen += 1
        }
        dispatch({ type: 'event', event: e })
      }

      void (async () => {
        let failure: string | null = null
        try {
          await streamVariants(request, readGeminiKey(), onEvent, ac.signal)
        } catch (err) {
          failure = err instanceof Error ? err.message : 'The connection broke'
        }
        controllers.current.delete(ac)
        if (unavailable || ac.signal.aborted) return
        const leftover = [...pending]
        if (leftover.length > 0) {
          dispatch({ type: 'fail', keys: leftover, reason: 'upstream', message: failure ?? 'The stream closed before this variant finished.' })
        }
        refund(failedSeen + leftover.length)
      })()
    },
    [allKeys, entry.gallery, refund],
  )

  // Start once on mount. The timer lets a StrictMode remount cancel the first start before any request is made.
  useEffect(() => {
    const live = controllers.current
    const t = window.setTimeout(() => run({ initial: true }), 0)
    return () => {
      window.clearTimeout(t)
      live.forEach((c) => c.abort())
      live.clear()
    }
  }, [run])

  const counts = useMemo(() => {
    let done = 0
    let failed = 0
    let working = 0
    for (const k of allKeys) {
      const s = state.tiles[k]?.status
      if (s === 'done') done += 1
      else if (s === 'failed') failed += 1
      else if (s === 'working') working += 1
    }
    return { done, failed, working, pending: total - done - failed }
  }, [allKeys, state.tiles, total])
  const running = !state.unavailable && counts.pending > 0
  const finished = counts.done + counts.failed

  useEffect(() => {
    if (state.unavailable) report({ label: 'Needs a Gemini key', tone: 'warn' })
    else if (counts.pending > 0) report({ label: finished === 0 && counts.working === 0 ? 'Starting' : `Generating ${finished} of ${total}`, tone: 'accent', progress: total ? finished / total : 0 })
    else if (counts.failed > 0) report({ label: `${counts.failed} failed`, tone: 'danger' })
    else report({ label: `${counts.done} variants ready`, tone: 'live' })
  }, [state.unavailable, counts, finished, total, report])

  const retry = (thumbId: string, index: number) => {
    if (!charge(1)) {
      toast.push({ title: 'Not enough credits', description: 'A retry costs 1 credit. Add credits from the top bar.', tone: 'warn' })
      return
    }
    run({ initial: false, only: [{ thumbId, index }] })
  }
  const regenerate = () => {
    if (!charge(total)) {
      toast.push({ title: 'Not enough credits', description: `Regenerating all needs ${total} credits. Add credits from the top bar.`, tone: 'warn' })
      return
    }
    run({ initial: false })
  }
  const restartWithKey = () => {
    if (!charge(total)) {
      toast.push({ title: 'Not enough credits', description: `This run needs ${total} credits. Add credits from the top bar.`, tone: 'warn' })
      return
    }
    dispatch({ type: 'restart' })
    run({ initial: true })
  }
  const addKey = () => openGemini?.()

  if (total === 0) {
    return <EmptyState icon={Images} sentence="This game has no gallery thumbnails to vary." actionLabel="Read how it works" onAction={() => navigate('/t/thumbnail-daemon', 'forward')} />
  }

  if (state.unavailable) {
    const cost = (total * COST_PER_VARIANT_USD).toFixed(2)
    return (
      <Panel title="Generating for this game needs a Gemini key">
        <div className="flex flex-col gap-16">
          <p className="max-w-prose text-body text-muted">
            {MODEL_NAME} makes each variant live when you press the button. Nothing is pre-made or stored. It needs a Gemini API key with billing enabled, at about $0.034 per variant. This run is <span className="tabular text-ink">{total}</span> variants, roughly <span className="tabular text-ink">${cost}</span>. Your {total} credits were returned.
          </p>
          <div className="flex flex-wrap gap-8">
            {geminiKey ? (
              <Button variant="primary" icon={RefreshCw} onClick={restartWithKey}>
                Generate {total} variants
              </Button>
            ) : (
              <Button variant="primary" onClick={addKey}>
                Add Gemini key
              </Button>
            )}
          </div>
        </div>
      </Panel>
    )
  }

  const live = state.mode === 'live'
  const zoomThumb = zoom ? thumbs.find((t) => t.id === zoom.thumbId) : undefined
  const zoomTile = zoom ? state.tiles[tileKey(zoom.thumbId, zoom.index)] : undefined
  const zoomN = zoom ? thumbs.findIndex((t) => t.id === zoom.thumbId) + 1 : 0

  return (
    <Panel
      title="Variants"
      actions={
        <>
          {live && (
            <Badge tone="live" dot>
              Live
            </Badge>
          )}
          {!running && (state.mode === 'live' || geminiKey) && (
            <Button variant="ghost" size="sm" icon={RefreshCw} onClick={regenerate}>
              Regenerate all
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-24">
        <div className="flex flex-col gap-8">
          <p className="tabular text-body text-ink">
            {total} variants from {thumbs.length} {thumbs.length === 1 ? 'thumbnail' : 'thumbnails'}, {VARIANTS_PER_THUMB} each. <span className="text-muted">{MODEL_NAME}</span>
          </p>
          <p className="text-label text-muted">Prompt: &ldquo;{VARIANT_PROMPT}&rdquo; with the thumbnail attached.</p>
          {running && (
            <div className="flex items-center gap-12" role="status">
              <span className="tabular shrink-0 text-label text-accent-ink">{finished === 0 && counts.working === 0 ? 'Starting' : `Generating ${finished} of ${total}`}</span>
              <ProgressBar value={total ? finished / total : 0} size="sm" label="Variants finished" className="flex-1" />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          {thumbs.map((thumb, row) => (
            <section key={thumb.id} aria-label={`Thumbnail ${row + 1} of ${thumbs.length}`} className="grid grid-cols-2 gap-12 border-t border-line py-16 first:border-t-0 first:pt-0 last:pb-0 xl:grid-cols-4">
              <OriginalFrame url={thumb.url} alt={`Original thumbnail ${row + 1}`} />
              {Array.from({ length: VARIANTS_PER_THUMB }, (_, i) => {
                const tile = state.tiles[tileKey(thumb.id, i)] ?? { status: 'queued' as const }
                return (
                  <VariantFrame
                    key={i}
                    tile={tile}
                    label={`Variant ${i + 1}`}
                    name={`Thumbnail ${row + 1}, variant ${i + 1}`}
                    downloadName={`${entry.id}-${thumb.id}-variant-${i + 1}${extOf(tile.src ?? '')}`}
                    onOpen={() => setZoom({ thumbId: thumb.id, index: i })}
                    onRetry={() => retry(thumb.id, i)}
                    onAddKey={addKey}
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
        description="The original on the left, the Nano Banana 2.1 variant on the right."
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
