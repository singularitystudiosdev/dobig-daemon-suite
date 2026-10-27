import { useCallback, useEffect, useRef, useState } from 'react'
import type { DaemonSlug } from '@/data/daemons'
import { listDaemons, resolveDiscord, resolveGame } from '@/lib/api'
import type { DaemonRecord, DiscordServerInfo } from '@/lib/runTypes'
import type { DiscordEntry, GameEntry, TargetEntry } from '../types'

/* The shell's view of the server: the daemon list (polled), and the entries rebuilt from it. The right-hand list IS the
   daemon list, so a reload shows the same targets again. */

export const FAST_POLL_MS = 5_000
export const SLOW_POLL_MS = 30_000

/** The id of the list entry a daemon becomes: `u<universeId>` for a Roblox game, `g<guildId>` for a Discord server. */
export function entryIdOf(d: DaemonRecord): string {
  return d.target.kind === 'roblox-game' ? `u${d.target.universeId}` : `g${d.target.guildId}`
}

export interface DaemonList {
  /** null until the first answer. */
  daemons: DaemonRecord[] | null
  /** The list request failed and there is nothing to show. */
  failed: boolean
  refresh: () => Promise<void>
  upsert: (d: DaemonRecord) => void
  drop: (id: string) => void
}

/** Lists this tool's daemons, polling every 5 s while any run is active and every 30 s otherwise. */
export function useDaemonList(slug: DaemonSlug, onRunEnded: () => void): DaemonList {
  const [daemons, setDaemons] = useState<DaemonRecord[] | null>(null)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)
  const latest = useRef<DaemonRecord[] | null>(null)
  const ended = useRef(onRunEnded)
  ended.current = onRunEnded

  const apply = useCallback((next: DaemonRecord[]) => {
    const sorted = [...next].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const prev = latest.current
    if (prev?.some((d) => d.activeRunId && sorted.some((n) => n.id === d.id && !n.activeRunId))) ended.current()
    latest.current = sorted
    setDaemons(sorted)
  }, [])

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const next = await listDaemons(slug)
      if (mine !== seq.current) return
      setFailed(false)
      apply(next)
    } catch {
      if (mine === seq.current) setFailed(latest.current === null)
    }
  }, [slug, apply])

  const upsert = useCallback(
    (d: DaemonRecord) => {
      seq.current++
      const rest = (latest.current ?? []).filter((x) => x.id !== d.id)
      apply([...rest, d])
    },
    [apply],
  )
  const drop = useCallback(
    (id: string) => {
      seq.current++
      apply((latest.current ?? []).filter((x) => x.id !== id))
    },
    [apply],
  )

  useEffect(() => {
    let timer = 0
    let stopped = false
    const tick = async () => {
      if (!document.hidden) await refresh()
      if (stopped) return
      const busy = latest.current?.some((d) => d.activeRunId) ?? false
      timer = window.setTimeout(tick, busy ? FAST_POLL_MS : SLOW_POLL_MS)
    }
    void tick()
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return { daemons, failed, refresh, upsert, drop }
}

type Resolution = { entry: TargetEntry } | { error: string }

export interface Entries {
  /** Entries by entry id, once rebuilt (or adopted from an add). */
  byId: Record<string, TargetEntry>
  /** Why an entry could not be rebuilt, by entry id. */
  errors: Record<string, string>
  adopt: (entry: TargetEntry) => void
  retry: (entryId: string) => void
}

/** Rebuilds an entry per daemon: Roblox games through resolveGame, Discord servers through resolveDiscord. A rebuilt
 *  entry never carries autoRun. Resolution is sequential so a long list does not trip Roblox's rate limit. */
export function useEntries(daemons: DaemonRecord[] | null): Entries {
  const [byId, setById] = useState<Record<string, TargetEntry>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)
  const started = useRef(new Set<string>())
  const queue = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    for (const d of daemons ?? []) {
      const id = entryIdOf(d)
      if (byId[id] || started.current.has(id)) continue
      started.current.add(id)
      queue.current = queue.current.then(async () => {
        const result = await rebuild(d)
        if (!alive.current) return
        if ('entry' in result) {
          setById((m) => (m[id] ? m : { ...m, [id]: result.entry }))
          setErrors((m) => {
            const { [id]: _gone, ...rest } = m
            return rest
          })
        } else {
          setErrors((m) => ({ ...m, [id]: result.error }))
          started.current.delete(id)
        }
      })
    }
  }, [daemons, byId, tick])

  const adopt = useCallback((entry: TargetEntry) => {
    started.current.add(entry.id)
    setById((m) => ({ ...m, [entry.id]: entry }))
    setErrors((m) => {
      const { [entry.id]: _gone, ...rest } = m
      return rest
    })
  }, [])
  const retry = useCallback((entryId: string) => {
    setErrors((m) => {
      const { [entryId]: _gone, ...rest } = m
      return rest
    })
    started.current.delete(entryId)
    setTick((n) => n + 1)
  }, [])

  return { byId, errors, adopt, retry }
}

async function rebuild(d: DaemonRecord): Promise<Resolution> {
  const addedAt = Date.parse(d.createdAt) || Date.now()
  if (d.target.kind === 'roblox-game') {
    const res = await resolveGame(String(d.target.placeId))
    if (!res.ok) return { error: res.message }
    const entry: GameEntry = { kind: 'roblox-game', id: `u${res.game.universeId}`, info: res.game, gallery: res.gallery, addedAt, daemonId: d.id }
    return { entry }
  }
  const target = d.target
  const res = await resolveDiscord(target.invite)
  if (res.ok) {
    const entry: DiscordEntry = { kind: 'discord-server', id: `g${res.server.guildId}`, server: res.server, addedAt, daemonId: d.id }
    return { entry }
  }
  // The invite may have expired. The daemon still works through the bot, so keep it, with only what the daemon knows.
  const server: DiscordServerInfo = {
    guildId: target.guildId,
    inviteCode: target.invite,
    name: target.name || d.title,
    description: null,
    iconUrl: d.image,
    bannerUrl: null,
    members: null,
    online: null,
    features: [],
    url: `https://discord.gg/${target.invite}`,
  }
  return { entry: { kind: 'discord-server', id: `g${target.guildId}`, server, addedAt, daemonId: d.id } }
}
