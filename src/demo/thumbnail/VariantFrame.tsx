import { useState } from 'react'
import { Download, ImageOff, KeyRound, LoaderCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { VariantFailure } from '@/lib/apiTypes'
import type { Tile } from './state'

/* One 16:9 frame. A variant frame is a rounded-8 raised box with a shimmer sweep while pending; when its image
   arrives it loads into the same frame and eases in only after it has decoded, so it never pops. */

export const REASON_COPY: Record<VariantFailure, string> = {
  blocked: 'Blocked by the model',
  'no-image': 'No image returned',
  'rate-limited': 'Rate limited',
  timeout: 'Timed out',
  upstream: 'Provider error',
  'no-key': 'No image key',
}

const chip = 'absolute left-8 top-8 rounded-full bg-canvas/70 px-8 py-2 text-micro font-medium text-ink'
const statusChip = 'absolute bottom-8 left-8 inline-flex items-center gap-6 rounded-full bg-canvas/70 px-8 py-2 text-micro text-ink'

/* The user-granted exception: a translucent light band swept across a pending frame. */
function Shimmer() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden motion-reduce:hidden">
      <div className="absolute inset-0 bg-linear-to-r from-transparent via-ink/10 to-transparent motion-safe:animate-shimmer" />
    </div>
  )
}

/** An image that stays hidden behind its placeholder until it has decoded, then settles in. */
function RevealImage({ src, alt, shimmer, onRetry }: { src: string; alt: string; shimmer?: boolean; onRetry?: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <div role="img" aria-label={`${alt}, image unavailable`} className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-raised p-8 text-center">
        <span className="text-micro text-muted">Image unavailable</span>
        {onRetry && (
          <span className="relative z-10">
            <Button size="sm" icon={RotateCw} onClick={onRetry}>
              Retry
            </Button>
          </span>
        )}
      </div>
    )
  }
  return (
    <>
      {!loaded && (shimmer ? <Shimmer /> : <div aria-hidden className="absolute inset-0 bg-raised motion-safe:animate-pulse" />)}
      <img
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoaded(true)
        }}
        src={src}
        alt={alt}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
        className={cn('absolute inset-0 size-full object-cover', loaded ? 'opacity-100 motion-safe:animate-settle' : 'opacity-0')}
      />
    </>
  )
}

export function OriginalFrame({ url, alt, isNew }: { url: string; alt: string; isNew?: boolean }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded-8 bg-raised">
      <RevealImage src={url} alt={alt} />
      <span className={chip}>Original</span>
      {isNew && <span className="absolute right-8 top-8 rounded-full bg-accent px-8 py-2 text-micro font-medium text-ink">New</span>}
    </div>
  )
}

export function VariantFrame({
  tile,
  label,
  name,
  downloadName,
  onOpen,
  onRetry,
  onAddKey,
}: {
  tile: Tile | { status: 'idle' }
  label: string
  name: string
  downloadName: string
  onOpen: () => void
  onRetry: () => void
  onAddKey: () => void
}) {
  if (tile.status === 'done' && tile.src) {
    return (
      <div role="group" aria-label={`${name}, ready`} className="relative aspect-video overflow-hidden rounded-8 bg-raised">
        <RevealImage key={tile.src} src={tile.src} alt={`${name} variant`} shimmer onRetry={onRetry} />
        <button type="button" onClick={onOpen} aria-label={`Enlarge ${name}`} className="absolute inset-0 rounded-8" />
        <span className={cn(chip, 'pointer-events-none')}>{label}</span>
        {tile.earlier && <span className={cn(statusChip, 'pointer-events-none text-muted')}>Generated earlier</span>}
        <a
          href={tile.src}
          download={downloadName}
          aria-label={`Download ${name}`}
          title="Download"
          className="state-layer absolute bottom-8 right-8 inline-flex size-32 items-center justify-center rounded-8 bg-canvas/70 text-ink"
        >
          <Download aria-hidden className="size-16" />
        </a>
      </div>
    )
  }

  if (tile.status === 'failed') {
    const noKey = tile.reason === 'no-key'
    return (
      <div role="group" aria-label={`${name}, failed`} className="relative flex aspect-video flex-col items-center justify-center gap-6 overflow-hidden rounded-8 bg-danger-soft p-8 text-center">
        <span className="inline-flex items-center gap-6 text-micro text-danger" title={tile.message}>
          <ImageOff aria-hidden className="size-12 shrink-0" />
          {REASON_COPY[tile.reason ?? 'upstream']}
        </span>
        {noKey ? (
          <Button size="sm" icon={KeyRound} onClick={onAddKey}>
            Add key
          </Button>
        ) : (
          <Button size="sm" icon={RotateCw} onClick={onRetry} aria-label={`Retry ${name}`}>
            Retry
          </Button>
        )}
        <span className={cn(chip, 'text-ink')}>{label}</span>
      </div>
    )
  }

  if (tile.status === 'idle') {
    return (
      <div role="group" aria-label={`${name}, not generated`} className="relative flex aspect-video items-center justify-center overflow-hidden rounded-8 border border-dashed border-line bg-sunken">
        <span className="text-micro text-subtle">Not generated</span>
        <span className={chip}>{label}</span>
      </div>
    )
  }

  const working = tile.status === 'working'
  return (
    <div role="group" aria-busy aria-label={`${name}, ${working ? 'generating' : 'queued'}`} className="relative aspect-video overflow-hidden rounded-8 bg-raised">
      <Shimmer />
      <span className={chip}>{label}</span>
      <span className={cn(statusChip, !working && 'text-muted')}>
        {working && <LoaderCircle aria-hidden className="size-12 motion-safe:animate-spin" />}
        {working ? 'Generating' : 'Queued'}
      </span>
    </div>
  )
}
