import { startTransition, useCallback, useEffect, useRef, useState, ViewTransition, type FormEvent, type RefObject } from 'react'
import { CircleAlert, Link2, Plus } from 'lucide-react'
import { Button, Field, Skeleton } from '@/components/ui'
import { CREDITS_PER_VARIANT, runCost, toolsBySlug, TRY_GAMES } from '@/data/tools'
import { ApiFailure, createDaemon, resolveGame } from '@/lib/api'
import type { ApiError, ResolveResponse } from '@/lib/apiTypes'
import { refreshCredits, useCredits } from '@/lib/credits'
import { checkGameLink } from '@/lib/links'
import { useReducedMotion } from '@/lib/hooks'
import { fmtCompact, fmtInt } from '@/lib/format'
import type { AddCardProps, GameEntry } from '../types'

/* The clean centred input card for the Roblox tools: paste a link, press the tool's verb. Resolves the game, shows it
   for a beat, then createDaemon() makes the daemon on the server (which starts the first run and charges for it) and
   the dashboard moves the new entry into the right-hand list. For the Thumbnail tool the press is the prompt to
   generate: the daemon created is the free gallery watcher and the workspace starts the variants. */

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'error'; message: string; retryAfter?: number }
  | { kind: 'found'; result: ResolveResponse }
  | { kind: 'creating'; result: ResolveResponse }
  | { kind: 'failed'; result: ResolveResponse; message: string; credits: boolean }

const CODE_COPY: Record<ApiError['code'], string> = {
  'bad-link': 'That does not look like a Roblox game link. Paste a roblox.com/games link or a place id.',
  'not-found': 'Roblox has no public game at that link. Check the id, or open the game page and copy its link.',
  private: 'That game is private. Make it public on Roblox, or try another game.',
  'rate-limited': 'Roblox is limiting requests right now.',
  upstream: 'Roblox did not answer. Try again in a moment.',
}

export function AddGameCard({ slug, balance, existingIds, inputRef, initialLink, focusOnMount, onTopUp, onAdd, onExisting }: AddCardProps) {
  const credits = useCredits(slug)
  const tool = toolsBySlug[slug]
  const reduced = useReducedMotion()
  const [link, setLink] = useState(initialLink)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [wait, setWait] = useState(0)
  const alive = useRef(true)
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

  const result = phase.kind === 'found' || phase.kind === 'creating' || phase.kind === 'failed' ? phase.result : null
  const free = slug === 'thumbnail-daemon'
  const cost = free ? 0 : credits.cost || runCost(slug)
  const short = phase.kind === 'found' && !free && !credits.loading && balance < cost
  const created = useRef<ResolveResponse | null>(null)
  const addRef = useRef(onAdd)
  addRef.current = onAdd

  const create = useCallback(
    async (found: ResolveResponse) => {
      setPhase({ kind: 'creating', result: found })
      try {
        const { daemon, runId } = await createDaemon({
          tool: slug,
          target: { kind: 'roblox-game', universeId: found.game.universeId, placeId: found.game.placeId, name: found.game.name },
        })
        if (!alive.current) return
        const entry: GameEntry = {
          kind: 'roblox-game',
          id: `u${found.game.universeId}`,
          info: found.game,
          gallery: found.gallery,
          addedAt: Date.now(),
          daemonId: daemon.id,
          autoRun: true,
        }
        void refreshCredits()
        startTransition(() => addRef.current(entry, runId, daemon))
      } catch (err) {
        if (!alive.current) return
        void refreshCredits()
        if (err instanceof ApiFailure && err.code === 'credits') {
          setPhase({ kind: 'failed', result: found, message: `This run needs ${fmtInt(cost)} credits, you have ${fmtInt(balance)}.`, credits: true })
        } else {
          setPhase({
            kind: 'failed',
            result: found,
            message: err instanceof ApiFailure && err.status !== 0 && err.status < 500 ? err.message : 'The daemon could not be created. Nothing was charged. Try again.',
            credits: false,
          })
        }
      }
    },
    [slug, cost, balance],
  )

  // After a beat on the found game, create the daemon. One request per found game: a re-render never sends a second.
  const found = phase.kind === 'found' ? phase.result : null
  useEffect(() => {
    if (!found || short || created.current === found) return
    const t = window.setTimeout(
      () => {
        created.current = found
        void create(found)
      },
      reduced ? 0 : 650,
    )
    return () => window.clearTimeout(t)
  }, [found, short, reduced, create])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (phase.kind === 'checking' || result) return
    void submit(link)
  }

  const cover = result ? (result.gallery[0]?.url ?? result.game.cover) : null
  const perRun = free ? `${fmtInt(CREDITS_PER_VARIANT)} credits per variant` : `${fmtInt(credits.cost || runCost(slug))} credits per run`

  return (
    <section aria-labelledby="add-game-title" className="mx-auto w-full max-w-640 rounded-20 border border-line bg-surface p-24 motion-safe:animate-enter sm:p-32">
      <h1 id="add-game-title" className="text-headline text-ink">
        Add a game
      </h1>
      {result ? (
        <div className="mt-24 flex flex-col gap-16" aria-live="polite">
          <div className="flex items-center gap-16">
            <ViewTransition name={`game-u${result.game.universeId}`} share="game-morph" default="none">
              <div className="aspect-video w-160 shrink-0 overflow-hidden rounded-8 bg-raised">
                {cover ? <img src={cover} alt="" width={160} height={90} className="size-full object-cover" /> : <Skeleton className="size-full" />}
              </div>
            </ViewTransition>
            <div className="min-w-0">
              <p className="truncate text-title font-bold text-ink">{result.game.name}</p>
              <p className="mt-4 text-label text-muted">
                {result.gallery.length} {result.gallery.length === 1 ? 'thumbnail' : 'thumbnails'}, {fmtCompact(result.game.playing)} playing
              </p>
            </div>
          </div>
          {phase.kind === 'failed' ? (
            <div role="alert" className="flex flex-col gap-12 rounded-8 bg-danger-soft p-16">
              <p className="tabular text-label text-danger">{phase.message}</p>
              <div className="flex flex-wrap gap-8">
                {phase.credits && (
                  <Button variant="primary" onClick={onTopUp}>
                    Add credits
                  </Button>
                )}
                <Button
                  variant={phase.credits ? 'normal' : 'primary'}
                  onClick={() => {
                    created.current = null
                    setPhase({ kind: 'found', result: phase.result })
                  }}
                >
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    created.current = null
                    setPhase({ kind: 'idle' })
                    inputRef.current?.focus()
                  }}
                >
                  Use another game
                </Button>
              </div>
            </div>
          ) : short ? (
            <div role="alert" className="flex flex-col gap-12 rounded-8 bg-warn-soft p-16">
              <p className="tabular text-label text-warn">
                This run needs {fmtInt(cost)} credits, you have {fmtInt(balance)}.
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
              {free ? 'Starting the gallery watch. It costs nothing.' : `Using ${fmtInt(cost)} credits. Starting the first run.`}
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
          <div className="flex flex-wrap items-center gap-8" role="group" aria-label="Games to try it on">
            <span className="text-micro text-muted">No game handy? Try a real one</span>
            {TRY_GAMES.map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => {
                  setLink(g.link)
                  if (phase.kind === 'error') setPhase({ kind: 'idle' })
                  inputRef.current?.focus()
                }}
                className="state-layer inline-flex h-32 items-center rounded-full border border-line px-12 text-micro text-ink"
              >
                {g.name}
              </button>
            ))}
          </div>
          {phase.kind === 'error' && (
            <div id="add-game-error" role="alert" className="flex items-start gap-8 rounded-8 bg-danger-soft p-12 text-label text-danger">
              <CircleAlert aria-hidden className="mt-2 size-16 shrink-0" />
              <p className="tabular">{phase.message}{wait > 0 ? ` Try again in ${wait}s.` : ''}</p>
            </div>
          )}
          <p className="tabular text-label text-muted">
            {credits.loading ? 'Reading your balance.' : `${fmtInt(balance)} credits available. ${tool.name} uses ${perRun}.`}
            {free ? ' Watching the gallery is free.' : ''}
          </p>
          <Button type="submit" variant="primary" size="lg" icon={phase.kind === 'checking' ? undefined : Plus} loading={phase.kind === 'checking'} disabled={wait > 0}>
            {phase.kind === 'checking' ? 'Checking game link' : phase.kind === 'error' ? (wait > 0 ? `Retry in ${wait}s` : 'Retry') : tool.runVerb}
          </Button>
        </form>
      )}
    </section>
  )
}
