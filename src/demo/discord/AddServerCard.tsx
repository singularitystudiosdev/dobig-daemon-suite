import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, CircleAlert, Circle, ExternalLink, Link2, Plus } from 'lucide-react'
import { Button, Field } from '@/components/ui'
import { createDaemon, resolveDiscord, ApiFailure } from '@/lib/api'
import type { ApiError } from '@/lib/apiTypes'
import { fmtInt } from '@/lib/format'
import { runCost, toolsBySlug } from '@/data/tools'
import type { DiscordServerInfo } from '@/lib/runTypes'
import type { AddCardProps, DiscordEntry } from '../types'
import { getBotStatus, type BotStatus } from './api'
import { ServerIcon } from './ServerHeader'
import { TokenForm, TokenSteps } from './TokenForm'

/* The Discord add card: paste an invite, see the server, get the bot ready (token, in the server, message content
   intent), then Start watching. Nothing starts by itself and a prefilled link is never submitted. */

type Phase = { kind: 'idle' } | { kind: 'checking' } | { kind: 'error'; message: string; retryAfter?: number } | { kind: 'found'; server: DiscordServerInfo }

const COST = runCost('discord-daemon')

function Step({ done, n, title, children }: { done: boolean | null; n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-12 border-b border-line py-16 first:pt-0 last:border-b-0 last:pb-0">
      <span aria-hidden className={`mt-2 inline-flex size-20 shrink-0 items-center justify-center rounded-full ${done ? 'bg-live-soft text-live' : 'bg-raised text-muted'}`}>
        {done ? <Check className="size-12" /> : done === null ? <Circle className="size-12" /> : <span className="tabular text-micro">{n}</span>}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        <p className="text-label font-medium text-ink">
          {title}
          <span className="sr-only">{done ? ', done' : ', not done yet'}</span>
        </p>
        {children}
      </div>
    </li>
  )
}

export function AddServerCard({ balance, existingIds, inputRef, initialLink, focusOnMount, onAdd, onExisting, onTopUp }: AddCardProps) {
  const tool = toolsBySlug['discord-daemon']
  const [link, setLink] = useState(initialLink)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<{ message: string; credits?: boolean } | null>(null)
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

  const found = phase.kind === 'found' ? phase.server : null
  const guildId = found?.guildId

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!guildId) return
      try {
        const s = await getBotStatus(guildId, signal)
        if (alive.current) setStatus(s)
      } catch {
        /* a failed poll keeps the last status; the next one retries */
      }
    },
    [guildId],
  )

  // Read the bot's state when a server is found, then every 4 s until the bot is in the server.
  const inGuild = status?.inGuild === true
  useEffect(() => {
    if (!guildId) {
      setStatus(null)
      return
    }
    const ac = new AbortController()
    void refresh(ac.signal)
    if (inGuild) return () => ac.abort()
    const t = window.setInterval(() => void refresh(ac.signal), 4000)
    return () => {
      window.clearInterval(t)
      ac.abort()
    }
  }, [guildId, inGuild, refresh])

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

  const submit = useCallback(
    async (raw: string) => {
      if (!raw.trim()) {
        setPhase({ kind: 'error', message: 'Paste a Discord invite link first, like https://discord.gg/abc123.' })
        inputRef.current?.focus()
        return
      }
      setPhase({ kind: 'checking' })
      setStartError(null)
      let result: { ok: true; server: DiscordServerInfo } | ApiError
      try {
        result = await resolveDiscord(raw.trim())
      } catch {
        return
      }
      if (!alive.current) return
      if (!result.ok) {
        setPhase({ kind: 'error', message: result.message, retryAfter: result.code === 'rate-limited' ? (result.retryAfter ?? 10) : undefined })
        return
      }
      if (existing.current.includes(`g${result.server.guildId}`)) {
        setPhase({ kind: 'idle' })
        onExisting(`g${result.server.guildId}`)
        return
      }
      setPhase({ kind: 'found', server: result.server })
    },
    [inputRef, onExisting],
  )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (phase.kind === 'checking') return
    void submit(link)
  }

  const start = async () => {
    if (!found || starting) return
    if (balance < COST) {
      setStartError({ message: `This run needs ${fmtInt(COST)} credits, you have ${fmtInt(balance)}.`, credits: true })
      return
    }
    setStarting(true)
    setStartError(null)
    try {
      const res = await createDaemon({ tool: 'discord-daemon', target: { kind: 'discord-server', invite: found.inviteCode, guildId: found.guildId, name: found.name } })
      const entry: DiscordEntry = { kind: 'discord-server', id: `g${found.guildId}`, server: found, addedAt: Date.now(), daemonId: res.daemon.id }
      onAdd(entry, res.runId)
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiFailure && err.status === 402) setStartError({ message: `This run needs ${fmtInt(COST)} credits, you have ${fmtInt(balance)}.`, credits: true })
      else setStartError({ message: err instanceof ApiFailure ? err.message : 'Could not start the daemon. Try again.' })
      setStarting(false)
    }
  }

  const tokenOk = status?.tokenSet === true && status.tokenValid !== false
  const ready = tokenOk && inGuild
  const missing = !status ? 'Checking the bot.' : !tokenOk ? 'Save the bot token first.' : !inGuild ? `Add the bot to ${found?.name ?? 'the server'} first.` : null

  return (
    <section aria-labelledby="add-server-title" className="mx-auto w-full max-w-640 rounded-20 border border-line bg-surface p-24 motion-safe:animate-enter sm:p-32">
      <h1 id="add-server-title" className="text-headline text-ink">
        Add a Discord server
      </h1>
      <form onSubmit={onSubmit} noValidate className="mt-24 flex flex-col gap-16">
        <Field label={tool.inputLabel} hint={tool.inputHint}>
          {(id) => (
            <div className="flex flex-wrap gap-8">
              <div className="relative min-w-160 flex-1">
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
                  placeholder="https://discord.gg/..."
                  value={link}
                  aria-invalid={phase.kind === 'error' || undefined}
                  aria-describedby="add-server-error"
                  onChange={(e) => {
                    setLink(e.target.value)
                    if (phase.kind === 'error') setPhase({ kind: 'idle' })
                    if (phase.kind === 'found') setPhase({ kind: 'idle' })
                  }}
                />
              </div>
              <Button type="submit" size="lg" loading={phase.kind === 'checking'} disabled={wait > 0}>
                {phase.kind === 'checking' ? 'Checking invite' : wait > 0 ? `Retry in ${wait}s` : 'Find server'}
              </Button>
            </div>
          )}
        </Field>
        {phase.kind === 'error' && (
          <div id="add-server-error" role="alert" className="flex items-start gap-8 rounded-8 bg-danger-soft p-12 text-label text-danger">
            <CircleAlert aria-hidden className="mt-2 size-16 shrink-0" />
            <p>{phase.message}</p>
          </div>
        )}
      </form>

      {found && (
        <div className="mt-24 flex flex-col gap-24 border-t border-line pt-24" aria-live="polite">
          <div className="flex items-center gap-16">
            <ServerIcon name={found.name} url={found.iconUrl} />
            <div className="min-w-0">
              <p className="truncate text-title font-bold text-ink">{found.name}</p>
              <p className="tabular mt-4 text-label text-muted">
                {found.members === null ? 'Member count not available' : `${fmtInt(found.members)} members`}
                {found.online !== null && `, ${fmtInt(found.online)} online`}
              </p>
              {found.description && <p className="mt-4 line-clamp-2 max-w-prose text-label text-muted">{found.description}</p>}
            </div>
          </div>

          <div>
            <h2 className="mb-16 text-label font-medium text-muted">Get your bot ready</h2>
            <ol className="flex flex-col">
              <Step n={1} done={tokenOk} title={tokenOk ? `Bot token saved${status?.bot ? ` (${status.bot.username})` : ''}` : status?.tokenValid === false ? 'Discord rejected the saved token' : 'Save your bot token'}>
                {!tokenOk && (
                  <div className="flex flex-col gap-12">
                    <TokenSteps />
                    <TokenForm onSaved={() => void refresh()} />
                  </div>
                )}
              </Step>
              <Step n={2} done={inGuild} title={inGuild ? `The bot is in ${found.name}` : `Add the bot to ${found.name}`}>
                {!inGuild && (
                  <div className="flex flex-col gap-8">
                    <p className="text-label text-muted">{tokenOk ? 'Pick the server in the window that opens. This page notices when the bot joins.' : 'Save the token first, then the Add button appears.'}</p>
                    {status?.inviteUrl && (
                      <div>
                        <a
                          href={status.inviteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="state-layer inline-flex h-40 items-center gap-8 rounded-8 border border-line bg-raised px-16 text-label font-medium text-ink"
                        >
                          Add the bot to {found.name}
                          <ExternalLink aria-hidden className="size-16" />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </Step>
              <Step n={3} done={null} title="Message Content Intent">
                <p className="text-label text-muted">Discord sends blank messages unless this is on in the Developer Portal (Bot, Privileged Gateway Intents). It cannot be checked ahead of time, so the first run tells you if it is off.</p>
              </Step>
            </ol>
          </div>

          {startError && (
            <div role="alert" className="flex flex-col gap-12 rounded-8 bg-warn-soft p-16">
              <p className="tabular text-label text-warn">{startError.message}</p>
              {startError.credits && (
                <div>
                  <Button variant="primary" onClick={onTopUp}>
                    Add credits
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col gap-8">
            <Button variant="primary" size="lg" icon={Plus} loading={starting} disabled={!ready} onClick={() => void start()}>
              {starting ? 'Starting' : 'Start watching'}
            </Button>
            <p className="tabular text-label text-muted">{missing ?? `${fmtInt(balance)} credits available. ${tool.name} uses ${fmtInt(COST)} credits per run and reruns every 12 hours.`}</p>
          </div>
        </div>
      )}
    </section>
  )
}
