import { startTransition, useCallback, useEffect, useRef, useState, ViewTransition, type FormEvent, type RefObject } from 'react'
import { CircleAlert, Link2, Plus } from 'lucide-react'
import { Button, Field, Skeleton } from '@/components/ui'
import { runCost, toolsBySlug } from '@/data/tools'
import type { DaemonSlug } from '@/data/daemons'
import { resolveGame } from '@/lib/api'
import type { ApiError, ResolveResponse } from '@/lib/apiTypes'
import { checkGameLink } from '@/lib/links'
import { useReducedMotion } from '@/lib/hooks'
import { fmtCompact } from '@/lib/format'
import type { GameEntry } from '../types'

/* The clean centred input card: paste a link, press the tool's verb. Resolves the game, checks the balance,
   shows the found game for a beat, then hands it to the dashboard, which moves it into the right rail. */

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'error'; message: string; retryAfter?: number }
  | { kind: 'found'; result: ResolveResponse }

const CODE_COPY: Record<ApiError['code'], string> = {
  'bad-link': 'That does not look like a Roblox game link. Paste a roblox.com/games link or a place id.',
  'not-found': 'Roblox has no public game at that link. Check the id, or open the game page and copy its link.',
  private: 'That game is private. Make it public on Roblox, or try another game.',
  'rate-limited': 'Roblox is limiting requests right now.',
  upstream: 'Roblox did not answer. Try again in a moment.',
}

export function AddGameCard({
  slug,
  balance,
  existingIds,
  inputRef,
  initialLink,
  autoSubmit,
  focusOnMount,
  spend,
  onTopUp,
  onAdd,
  onExisting,
}: {
  slug: DaemonSlug
  balance: number
  existingIds: string[]
  inputRef: RefObject<HTMLInputElement | null>
  initialLink: string
  autoSubmit: boolean
  focusOnMount: boolean
  spend: (n: number) => boolean
  onTopUp: () => void
  onAdd: (entry: GameEntry) => void
  onExisting: (id: string) => void
}) {
  const tool = toolsBySlug[slug]
  const reduced = useReducedMotion()
  const [link, setLink] = useState(initialLink)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [wait, setWait] = useState(0)
  const alive = useRef(true)
  const autoFired = useRef(false)
  const existing = useRef(existingIds)
  existing.current = existingIds

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus()
  }, [focusOnMount, inputRef])

  const submit = useCallback(
    async (raw: string) => {
      const check = checkGameLink(raw)
      if (!check.ok) {
        setPhase({ kind: 'error', message: check.message })
        inputRef.current?.focus()
        return
      }
      setPhase({ kind: 'checking' })
      let result: ResolveResponse | ApiError
      try {
        result = await resolveGame(check.value)
      } catch {
        return
      }
      if (!alive.current) return
      if (!result.ok) {
        setPhase({ kind: 'error', message: CODE_COPY[result.code], retryAfter: result.code === 'rate-limited' ? (result.retryAfter ?? 10) : undefined })
        return
      }
      if (slug === 'thumbnail-daemon' && result.gallery.length === 0) {
        setPhase({ kind: 'error', message: `${result.game.name} has no gallery thumbnails to vary. Try a game with images on its page.` })
        return
      }
      const id = `u${result.game.universeId}`
      if (existing.current.includes(id)) {
        setPhase({ kind: 'idle' })
        onExisting(id)
        return
      }
      setPhase({ kind: 'found', result })
    },
    [inputRef, onExisting, slug],
  )

  // Deep link: prefill and submit once. A ref survives the StrictMode remount, so it never charges twice.
  useEffect(() => {
    if (!autoSubmit || autoFired.current || !initialLink) return
    autoFired.current = true
    void submit(initialLink)
  }, [autoSubmit, initialLink, submit])

  // Rate limit countdown.
  const retryAfter = phase.kind === 'error' ? phase.retryAfter : undefined
  useEffect(() => {
    if (!retryAfter) {
      setWait(0)
      return
    }
    setWait(retryAfter)
    const t = window.setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => window.clearInterval(t)
  }, [retryAfter, phase])

  const found = phase.kind === 'found' ? phase.result : null
  const cost = found ? runCost(slug, found.gallery.length) : runCost(slug, 0)
  const short = found !== null && balance < cost

  // After a beat on the found game, charge and move it into the rail.
  useEffect(() => {
    if (!found || short) return
    const t = window.setTimeout(
      () => {
        if (!spend(cost)) return
        const entry: GameEntry = { id: `u${found.game.universeId}`, info: found.game, gallery: found.gallery, addedAt: Date.now() }
        startTransition(() => onAdd(entry))
      },
      reduced ? 0 : 650,
    )
    return () => window.clearTimeout(t)
  }, [found, short, cost, reduced, spend, onAdd])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (phase.kind === 'checking' || found) return
    void submit(link)
  }

  const cover = found ? (found.gallery[0]?.url ?? found.game.cover) : null
  const perRun = slug === 'thumbnail-daemon' ? '1 credit per variant' : `${runCost(slug)} credits per run`

  return (
    <section aria-labelledby="add-game-title" className="mx-auto w-full max-w-640 rounded-20 border border-line bg-surface p-24 motion-safe:animate-enter sm:p-32">
      <h1 id="add-game-title" className="text-headline text-ink">
        Add a game
      </h1>
      {found ? (
        <div className="mt-24 flex flex-col gap-16" aria-live="polite">
          <div className="flex items-center gap-16">
            <ViewTransition name={`game-u${found.game.universeId}`} share="game-morph" default="none">
              <div className="aspect-video w-160 shrink-0 overflow-hidden rounded-8 bg-raised">
                {cover ? <img src={cover} alt="" width={160} height={90} className="size-full object-cover" /> : <Skeleton className="size-full" />}
              </div>
            </ViewTransition>
            <div className="min-w-0">
              <p className="truncate text-title font-bold text-ink">{found.game.name}</p>
              <p className="mt-4 text-label text-muted">
                {found.gallery.length} {found.gallery.length === 1 ? 'thumbnail' : 'thumbnails'}, {fmtCompact(found.game.playing)} playing
              </p>
            </div>
          </div>
          {short ? (
            <div role="alert" className="flex flex-col gap-12 rounded-8 bg-warn-soft p-16">
              <p className="tabular text-label text-warn">
                This run needs {cost} credits, you have {balance}.
              </p>
              <div className="flex flex-wrap gap-8">
                <Button variant="primary" onClick={onTopUp}>
                  Add credits
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPhase({ kind: 'idle' })
                    inputRef.current?.focus()
                  }}
                >
                  Use another game
                </Button>
              </div>
            </div>
          ) : (
            <p className="tabular text-label text-muted">
              Using {cost} {cost === 1 ? 'credit' : 'credits'}. Adding it to your list.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-24 flex flex-col gap-16">
          <Field label={tool.inputLabel} hint={tool.inputHint}>
            {(id) => (
              <div className="relative">
                <Link2 aria-hidden className="pointer-events-none absolute left-12 top-1/2 size-20 -translate-y-1/2 text-muted" />
                <input
                  ref={inputRef}
                  id={id}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="h-48 w-full min-w-0 rounded-8 border border-line bg-raised pl-40 pr-12 text-body text-ink placeholder:text-subtle"
                  placeholder="https://www.roblox.com/games/..."
                  value={link}
                  aria-invalid={phase.kind === 'error' || undefined}
                  aria-describedby="add-game-error"
                  onChange={(e) => {
                    setLink(e.target.value)
                    if (phase.kind === 'error') setPhase({ kind: 'idle' })
                  }}
                />
              </div>
            )}
          </Field>
          {phase.kind === 'error' && (
            <div id="add-game-error" role="alert" className="flex items-start gap-8 rounded-8 bg-danger-soft p-12 text-label text-danger">
              <CircleAlert aria-hidden className="mt-2 size-16 shrink-0" />
              <p className="tabular">{phase.message}{wait > 0 ? ` Try again in ${wait}s.` : ''}</p>
            </div>
          )}
          <p className="tabular text-label text-muted">
            {balance} credits available. {tool.name} uses {perRun}.
          </p>
          <Button type="submit" variant="primary" size="lg" icon={phase.kind === 'checking' ? undefined : Plus} loading={phase.kind === 'checking'} disabled={wait > 0}>
            {phase.kind === 'checking' ? 'Checking game link' : phase.kind === 'error' ? (wait > 0 ? `Retry in ${wait}s` : 'Retry') : tool.runVerb}
          </Button>
        </form>
      )}
    </section>
  )
}
