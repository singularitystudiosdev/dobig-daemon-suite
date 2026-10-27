import crypto from 'node:crypto'
import type { DaemonSlug } from '../src/data/daemons.ts'
import { tools } from '../src/data/tools.ts'
import {
  DAEMON_INTERVAL_HOURS,
  TOOL_TARGET,
  type CreateDaemonResponse,
  type DaemonDetail,
  type DaemonRecord,
  type Target,
} from '../src/lib/runTypes.ts'
import type { RunEngine } from './runs.ts'
import type { Store } from './store.ts'
import { describeTarget as realDescribe } from './targets.ts'
import type { RouteContext } from './tools/types.ts'

/* Daemons: the persisted records (daemons.json) behind the right-hand list, and the scheduler that reruns them.
   A daemon is a tool + a target + an interval. The scheduler ticks every DAEMON_TICK_MS and starts a run for every
   enabled daemon whose nextRunAt has passed and that has no run in progress; a run's end sets lastRunAt and
   nextRunAt = end + interval. A daemon that was overdue after downtime runs once, not once per missed interval. */

type Stored = Omit<DaemonRecord, 'activeRunId' | 'last'>

export interface Route {
  method: string
  path: string
  handler: (ctx: RouteContext, params: Record<string, string>) => Promise<void>
}

export interface DaemonsOptions {
  store: Store
  runs: RunEngine
  describe?: typeof realDescribe
  defaultIntervalHours?: number
  discordApiBase?: string
  /** Smallest interval a request may set (default 0.001 hours); tests lower it to watch the scheduler quickly. */
  minIntervalHours?: number
}

export interface Daemons {
  list(tool?: DaemonSlug): DaemonRecord[]
  get(id: string): DaemonRecord | undefined
  /** Starts a run for every due daemon; returns how many it started. */
  tick(now?: number): number
  startScheduler(tickMs: number): void
  stopScheduler(): void
  onRunEnd(daemonId: string, endedAt: string): void
  routes: Route[]
}

const FILE = 'daemons.json'
const MIN_HOURS = 0.001
const MAX_HOURS = 168
const HOUR_MS = 3_600_000
const SLUGS = new Set<string>(tools.map((t) => t.slug))

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < Number.MAX_SAFE_INTEGER
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)

/** Validates a target from the wire and returns a clean copy of it. */
export function cleanTarget(kind: string, raw: unknown): Target | null {
  if (!isObj(raw) || raw.kind !== kind) return null
  if (kind === 'roblox-game') {
    const name = text(raw.name, 200)
    if (!posInt(raw.universeId) || !posInt(raw.placeId) || !name) return null
    return { kind: 'roblox-game', universeId: raw.universeId, placeId: raw.placeId, name }
  }
  const invite = text(raw.invite, 64)
  const guildId = text(raw.guildId, 25)
  const name = text(raw.name, 200)
  if (!invite || !/^[A-Za-z0-9-]{2,64}$/.test(invite) || !guildId || !/^\d{1,25}$/.test(guildId) || !name) return null
  return { kind: 'discord-server', invite, guildId, name }
}

const targetKey = (t: Target) => (t.kind === 'roblox-game' ? `r${t.placeId}` : `d${t.guildId}`)

export function createDaemons(options: DaemonsOptions): Daemons {
  const { store, runs } = options
  const describe = options.describe ?? realDescribe
  const defaultHours = options.defaultIntervalHours ?? DAEMON_INTERVAL_HOURS
  const MIN = options.minIntervalHours ?? MIN_HOURS
  const saved = store.load<{ daemons: Stored[] }>(FILE, { daemons: [] }, (v): v is { daemons: Stored[] } => isObj(v) && Array.isArray(v.daemons))
  const records: Stored[] = saved.daemons.filter((d) => isObj(d) && typeof d.id === 'string' && SLUGS.has(d.tool) && isObj(d.target))
  let timer: ReturnType<typeof setInterval> | undefined

  const persist = () => void store.save(FILE, { daemons: records })
  const find = (id: string) => records.find((d) => d.id === id)
  const view = (d: Stored): DaemonRecord => {
    const out: DaemonRecord = { ...d }
    const active = runs.activeRunId(d.id)
    if (active) out.activeRunId = active
    const last = runs.lastFinished(d.id)
    if (last) out.last = last
    return out
  }
  const nextFrom = (d: Stored, from: number) => new Date(from + d.intervalHours * HOUR_MS).toISOString()

  function onRunEnd(daemonId: string, endedAt: string): void {
    const d = find(daemonId)
    if (!d) return
    d.lastRunAt = endedAt
    if (d.enabled) d.nextRunAt = nextFrom(d, Date.parse(endedAt))
    persist()
  }

  function tick(now = Date.now()): number {
    let started = 0
    for (const d of records) {
      if (!d.enabled || !d.nextRunAt || Date.parse(d.nextRunAt) > now) continue
      if (runs.activeRunId(d.id)) continue
      d.runs++
      runs.startRun(view(d), 'schedule')
      started++
      persist()
    }
    return started
  }

  function startRunFor(d: Stored, trigger: 'user' | 'schedule') {
    d.runs++
    persist()
    return runs.startRun(view(d), trigger)
  }

  const creditsBody = (s: { needed: number; balance: number; message: string }) => ({ ok: false, code: 'credits', message: s.message, needed: s.needed, balance: s.balance })
  const bad = (ctx: RouteContext, message: string, code = 'bad-input', status = 400) => ctx.json(status, { ok: false, code, message })
  const toolParam = (v: unknown): DaemonSlug | null => (typeof v === 'string' && SLUGS.has(v) ? (v as DaemonSlug) : null)

  const routes: Route[] = [
    {
      method: 'GET',
      path: '/api/daemons',
      async handler(ctx) {
        const raw = ctx.url.searchParams.get('tool')
        const tool = raw === null ? undefined : toolParam(raw)
        if (tool === null) return bad(ctx, 'Unknown tool.')
        ctx.json(200, { daemons: records.filter((d) => !tool || d.tool === tool).map(view) })
      },
    },
    {
      method: 'POST',
      path: '/api/daemons',
      async handler(ctx) {
        const body = await ctx.body()
        if (!isObj(body)) return bad(ctx, 'Send a JSON object with tool and target.')
        const tool = toolParam(body.tool)
        if (!tool) return bad(ctx, 'Unknown tool.')
        const target = cleanTarget(TOOL_TARGET[tool], body.target)
        if (!target) return bad(ctx, `This tool needs a ${TOOL_TARGET[tool]} target with its ids and name.`)
        let intervalHours = defaultHours
        if (body.intervalHours !== undefined) {
          const h = body.intervalHours
          if (typeof h !== 'number' || !Number.isFinite(h) || h < MIN || h > MAX_HOURS) return bad(ctx, `intervalHours must be between ${MIN} and ${MAX_HOURS}.`)
          intervalHours = h
        }
        const key = `${tool}:${targetKey(target)}`
        const dup = () => records.find((d) => `${d.tool}:${targetKey(d.target)}` === key)

        let existing = dup()
        if (existing) {
          const active = runs.activeRunId(existing.id)
          if (active) return ctx.json(200, { daemon: view(existing), runId: active } satisfies CreateDaemonResponse)
          const short = runs.shortfall(tool)
          if (short) return ctx.json(402, creditsBody(short))
          const r = startRunFor(existing, 'user')
          return ctx.json(200, { daemon: view(existing), runId: r.runId } satisfies CreateDaemonResponse)
        }

        const short = runs.shortfall(tool)
        if (short) return ctx.json(402, creditsBody(short))
        const info = await describe(target, { discordApiBase: options.discordApiBase })
        existing = dup() // another request may have created it while we described the target
        if (existing) {
          const active = runs.activeRunId(existing.id)
          const runId = active ?? startRunFor(existing, 'user').runId
          return ctx.json(200, { daemon: view(existing), runId } satisfies CreateDaemonResponse)
        }
        const now = Date.now()
        const d: Stored = {
          id: crypto.randomUUID(),
          tool,
          target,
          title: info.title,
          image: info.image,
          intervalHours,
          enabled: true,
          createdAt: new Date(now).toISOString(),
          runs: 0,
        }
        d.nextRunAt = nextFrom(d, now)
        records.push(d)
        const r = startRunFor(d, 'user')
        ctx.json(201, { daemon: view(d), runId: r.runId } satisfies CreateDaemonResponse)
      },
    },
    {
      method: 'GET',
      path: '/api/daemons/:id',
      async handler(ctx, { id }) {
        const d = find(id)
        if (!d) return bad(ctx, 'No such daemon. It may have been deleted.', 'not-found', 404)
        const detail: DaemonDetail = { ...view(d), latest: runs.latest(d.id), history: runs.summaries(d.id, 30) }
        ctx.json(200, detail)
      },
    },
    {
      method: 'PATCH',
      path: '/api/daemons/:id',
      async handler(ctx, { id }) {
        const d = find(id)
        if (!d) return bad(ctx, 'No such daemon. It may have been deleted.', 'not-found', 404)
        const body = await ctx.body()
        if (!isObj(body)) return bad(ctx, 'Send a JSON object with enabled and/or intervalHours.')
        if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return bad(ctx, 'enabled must be true or false.')
        if (body.intervalHours !== undefined) {
          const h = body.intervalHours
          if (typeof h !== 'number' || !Number.isFinite(h) || h < MIN || h > MAX_HOURS) return bad(ctx, `intervalHours must be between ${MIN} and ${MAX_HOURS}.`)
        }
        const now = Date.now()
        const wasEnabled = d.enabled
        if (typeof body.enabled === 'boolean') d.enabled = body.enabled
        if (typeof body.intervalHours === 'number') d.intervalHours = body.intervalHours
        if (!d.enabled) delete d.nextRunAt
        else if (typeof body.intervalHours === 'number' || !wasEnabled) {
          const base = d.lastRunAt ? Date.parse(d.lastRunAt) : Date.parse(d.createdAt)
          const next = base + d.intervalHours * HOUR_MS
          // Resuming a paused daemon runs it on the next tick if it is overdue; it never waits for a lapsed slot.
          d.nextRunAt = new Date(!wasEnabled ? Math.max(next, now) : next).toISOString()
        }
        persist()
        ctx.json(200, view(d))
      },
    },
    {
      method: 'POST',
      path: '/api/daemons/:id/run',
      async handler(ctx, { id }) {
        const d = find(id)
        if (!d) return bad(ctx, 'No such daemon. It may have been deleted.', 'not-found', 404)
        const active = runs.activeRunId(d.id)
        if (active) return ctx.json(200, { runId: active })
        const short = runs.shortfall(d.tool)
        if (short) return ctx.json(402, creditsBody(short))
        ctx.json(200, { runId: startRunFor(d, 'user').runId })
      },
    },
    {
      method: 'DELETE',
      path: '/api/daemons/:id',
      async handler(ctx, { id }) {
        const d = find(id)
        if (!d) return bad(ctx, 'No such daemon. It may have been deleted.', 'not-found', 404)
        records.splice(records.indexOf(d), 1)
        persist()
        await runs.discardDaemon(id)
        ctx.json(200, { ok: true })
      },
    },
  ]

  return {
    list: (tool) => records.filter((d) => !tool || d.tool === tool).map(view),
    get: (id) => {
      const d = find(id)
      return d ? view(d) : undefined
    },
    tick,
    startScheduler(tickMs) {
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        try {
          tick()
        } catch (err) {
          console.error('[daemons] scheduler tick failed:', err instanceof Error ? err.message : String(err))
        }
      }, tickMs)
      timer.unref?.()
      // Pick up anything already overdue straight away instead of waiting a whole tick.
      queueMicrotask(() => timer && tick())
    },
    stopScheduler() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
    onRunEnd,
    routes,
  }
}
