import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DaemonSlug } from '../src/data/daemons.ts'
import type { DaemonRecord, Finding, RunEvent, RunRecordSummary, RunStatus, Target } from '../src/lib/runTypes.ts'
import { costOf, type Credits } from './credits.ts'
import { sendJson, startNdjson } from './http.ts'
import type { Llm } from './llm.ts'
import type { SecretStore } from './secrets.ts'
import type { Store } from './store.ts'
import { RunError, type Analyzer, type Memory, type RunContext } from './tools/types.ts'

/* The run engine. A run is one execution of an analyzer for one daemon: it is charged when it starts, executes with
   a RunContext that appends RunEvents, persists its event log (every 2 s while running and at the end) and is
   replayable from disk after a restart. Limits: one active run per daemon, a few runs at once (the rest wait
   queued), the newest 30 runs per daemon kept. */

export const GENERIC_ERROR = 'This run hit an unexpected error. Try again.'
const FLUSH_MS = 2000
const KEEP_RUNS = 30

export interface RunMeta extends RunRecordSummary {
  daemonId: string
  tool: DaemonSlug
  refunded: number
}

interface RunFile {
  meta: RunMeta
  events: RunEvent[]
}

interface Live {
  meta: RunMeta
  events: RunEvent[]
  daemon: DaemonRecord
  listeners: Set<(e: RunEvent) => void>
  ac: AbortController
  finished: Promise<void>
  resolveFinished: () => void
  /** Set when the daemon is deleted: the run still ends (and refunds) but writes nothing to disk. */
  discarded: boolean
  closed: boolean
  dirty: boolean
  flushTimer?: ReturnType<typeof setInterval>
  t0: number
  start: () => void
}

export interface CreditsShortfall {
  needed: number
  balance: number
  message: string
}

export type StartResult = { runId: string; existing: boolean; shortfall?: CreditsShortfall }

export interface RunEngineOptions {
  store: Store
  credits: Credits
  secrets: SecretStore
  /** Builds the LLM client for one run (so a key saved later is used). */
  makeLlm: () => Llm
  /** Picks the analyzer for a tool. */
  analyzerFor: (tool: DaemonSlug) => Analyzer
  maxConcurrent?: number
  /** Called when a run ends (any status), with the end time. Used to reschedule the daemon. */
  onRunEnd?: (daemonId: string, endedAt: string, meta: RunMeta) => void
}

export interface RunEngine {
  startRun(daemon: DaemonRecord, trigger: 'user' | 'schedule'): StartResult
  /** Credits shortfall for one run of this tool, or null when affordable. */
  shortfall(tool: DaemonSlug): CreditsShortfall | null
  activeRunId(daemonId: string): string | undefined
  summaries(daemonId: string, limit?: number): RunRecordSummary[]
  /** The last run that is not queued or running. */
  lastFinished(daemonId: string): RunRecordSummary | undefined
  meta(runId: string): RunMeta | undefined
  events(runId: string): RunEvent[] | null
  /** Events of the active run, else of the newest run. */
  latest(daemonId: string): { runId: string; events: RunEvent[] } | null
  stream(req: IncomingMessage, res: ServerResponse, runId: string): void
  /** Aborts and awaits the daemon's runs, then deletes its run files and memory. */
  discardDaemon(daemonId: string): Promise<void>
  /** Aborts every run and waits for them to be recorded. */
  stop(): Promise<void>
  /** Resolves when no run is queued or running (tests). */
  idle(): Promise<void>
  counts(): { running: number; queued: number }
}

const isRunFile = (v: unknown): v is RunFile => {
  const o = v as RunFile | null
  return !!o && typeof o === 'object' && !!o.meta && typeof o.meta.runId === 'string' && Array.isArray(o.events)
}

const fmt = (n: number) => n.toLocaleString('en-US')

export function createRunEngine(options: RunEngineOptions): RunEngine {
  const { store, credits, secrets } = options
  const maxConcurrent = options.maxConcurrent ?? 3
  const metas = new Map<string, RunMeta>()
  const live = new Map<string, Live>()
  const byDaemonActive = new Map<string, string>()
  const queue: Live[] = []
  const memories = new Map<string, Record<string, unknown>>()
  let running = 0
  let stopped = false

  const runPath = (runId: string) => `runs/${runId}.json`
  const memPath = (daemonId: string) => `memory/${daemonId}.json`

  const scrub = (text: string) => secrets.scrub(text)

  /* ---- startup: index run files, close out runs a restart interrupted ---- */
  for (const name of store.list('runs')) {
    if (!name.endsWith('.json')) continue
    const file = store.load<RunFile | null>(`runs/${name}`, null, isRunFile)
    if (!file) continue
    const { meta, events } = file
    if (meta.status === 'queued' || meta.status === 'running') {
      const hasFindings = events.some((e) => e.type === 'finding')
      const refunded = hasFindings ? 0 : meta.cost
      if (refunded) credits.refund(meta.tool, refunded)
      events.push({ type: 'error', code: 'aborted', message: 'The server restarted while this run was in progress. It will run again on the next check.' })
      events.push({ type: 'end', status: 'failed', findings: meta.findings, newFindings: meta.newFindings, durationMs: 0, refunded })
      meta.status = 'failed'
      meta.endedAt = new Date().toISOString()
      meta.error = 'The server restarted while this run was in progress.'
      meta.refunded = refunded
      void store.save(runPath(meta.runId), file)
    }
    metas.set(meta.runId, meta)
  }

  /* ---- memory ---- */
  function memoryFor(daemonId: string): Record<string, unknown> {
    let m = memories.get(daemonId)
    if (!m) {
      m = store.load<Record<string, unknown>>(memPath(daemonId), {}, (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
      memories.set(daemonId, m)
    }
    return m
  }

  function memoryApi(daemonId: string): Memory {
    return {
      get<T>(key: string): T | undefined {
        const v = memoryFor(daemonId)[key]
        return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T)
      },
      set(key: string, value: unknown) {
        const m = memoryFor(daemonId)
        m[key] = JSON.parse(JSON.stringify(value ?? null))
        void store.save(memPath(daemonId), m)
      },
    }
  }

  /* ---- helpers ---- */
  const toSummary = (m: RunMeta): RunRecordSummary => {
    const s: RunRecordSummary = { runId: m.runId, startedAt: m.startedAt, status: m.status, findings: m.findings, newFindings: m.newFindings, cost: m.cost, trigger: m.trigger }
    if (m.endedAt) s.endedAt = m.endedAt
    if (m.error) s.error = m.error
    return s
  }

  const runsOf = (daemonId: string): RunMeta[] =>
    [...metas.values()]
      .filter((m) => m.daemonId === daemonId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))

  function eventsOf(runId: string): RunEvent[] | null {
    const l = live.get(runId)
    if (l) return l.events
    if (!metas.has(runId)) return null
    const file = store.load<RunFile | null>(runPath(runId), null, isRunFile)
    return file ? file.events : null
  }

  function previousFindings(daemonId: string): { exists: boolean; findings: Finding[] } {
    const last = runsOf(daemonId).find((m) => m.status === 'done' && !live.has(m.runId))
    if (!last) return { exists: false, findings: [] }
    const events = eventsOf(last.runId) ?? []
    return { exists: true, findings: events.flatMap((e) => (e.type === 'finding' ? [e.finding] : [])) }
  }

  function persist(l: Live): Promise<void> {
    if (l.discarded) return Promise.resolve()
    l.dirty = false
    return store.save(runPath(l.meta.runId), { meta: l.meta, events: l.events } satisfies RunFile)
  }

  function emit(l: Live, e: RunEvent): void {
    if (l.closed) return
    l.events.push(e)
    l.dirty = true
    for (const fn of [...l.listeners]) {
      try {
        fn(e)
      } catch {
        l.listeners.delete(fn)
      }
    }
  }

  function prune(daemonId: string): void {
    const all = runsOf(daemonId)
    for (const m of all.slice(KEEP_RUNS)) {
      if (live.has(m.runId)) continue
      metas.delete(m.runId)
      void store.remove(runPath(m.runId))
    }
  }

  function shortfall(tool: DaemonSlug): CreditsShortfall | null {
    const needed = costOf(tool)
    const balance = credits.balance(tool)
    if (balance >= needed) return null
    return { needed, balance, message: `This run costs ${fmt(needed)} credits and this tool has ${fmt(balance)} left. Add credits to run it.` }
  }

  /* ---- execution ---- */
  async function execute(l: Live): Promise<void> {
    const { meta, daemon } = l
    meta.status = 'running'
    l.t0 = Date.now()
    l.dirty = true
    l.flushTimer = setInterval(() => {
      if (l.dirty) void persist(l)
    }, FLUSH_MS)
    l.flushTimer.unref?.()
    void persist(l)

    const prev = previousFindings(daemon.id)
    const prevIds = new Set(prev.findings.map((f) => f.id))
    const seen = new Set<string>()
    let findings = 0
    let newFindings = 0
    const target: Target = daemon.target
    const ctx: RunContext = {
      tool: daemon.tool,
      target,
      trigger: meta.trigger,
      runId: meta.runId,
      daemonId: daemon.id,
      now: new Date(),
      signal: l.ac.signal,
      step(id, label, state, detail) {
        const e: RunEvent = { type: 'step', id, label, state, at: Date.now() - l.t0 }
        if (detail !== undefined) e.detail = detail
        emit(l, e)
      },
      summary(summary) {
        emit(l, { type: 'summary', summary })
      },
      finding(finding) {
        if (seen.has(finding.id)) return
        seen.add(finding.id)
        const isNew = prev.exists && !prevIds.has(finding.id)
        findings++
        if (isNew) newFindings++
        meta.findings = findings
        meta.newFindings = newFindings
        emit(l, { type: 'finding', finding: { ...finding, isNew } })
      },
      llm: options.makeLlm(),
      secrets,
      memory: memoryApi(daemon.id),
      previous: prev.findings,
    }

    let failure: { code: RunError['code']; message: string; action?: RunError['action'] } | null = null
    try {
      await options.analyzerFor(daemon.tool)(ctx)
      if (l.ac.signal.aborted) failure = { code: 'aborted', message: 'The run was cancelled.' }
    } catch (err) {
      if (l.ac.signal.aborted) failure = { code: 'aborted', message: 'The run was cancelled.' }
      else if (err instanceof RunError) failure = { code: err.code, message: scrub(err.message), action: err.action }
      else {
        console.error('[run] analyzer failed:', scrub(err instanceof Error ? (err.stack ?? err.message) : String(err)))
        failure = { code: 'internal', message: GENERIC_ERROR }
      }
    }

    if (l.flushTimer) clearInterval(l.flushTimer)
    const refunded = failure && findings === 0 ? meta.cost : 0
    if (refunded > 0) credits.refund(meta.tool, refunded)
    if (failure) {
      const e: RunEvent = { type: 'error', code: failure.code, message: failure.message }
      if (failure.action) e.action = failure.action
      emit(l, e)
      meta.error = failure.message
    }
    meta.status = failure ? 'failed' : 'done'
    meta.endedAt = new Date().toISOString()
    meta.refunded = refunded
    emit(l, { type: 'end', status: meta.status, findings, newFindings, durationMs: Date.now() - l.t0, refunded })
    finalize(l)
  }

  function finalize(l: Live): void {
    l.closed = true
    live.delete(l.meta.runId)
    if (byDaemonActive.get(l.meta.daemonId) === l.meta.runId) byDaemonActive.delete(l.meta.daemonId)
    const done = persist(l)
    if (!l.discarded) prune(l.meta.daemonId)
    l.listeners.clear()
    if (!l.discarded && !stopped) options.onRunEnd?.(l.meta.daemonId, l.meta.endedAt ?? new Date().toISOString(), l.meta)
    void done.finally(() => l.resolveFinished())
    pump()
  }

  function pump(): void {
    while (!stopped && running < maxConcurrent && queue.length > 0) {
      const next = queue.shift()!
      running++
      next.start()
    }
  }

  function abortLive(l: Live): void {
    const qi = queue.indexOf(l)
    if (qi >= 0) {
      // Never started: record it as cancelled right now.
      queue.splice(qi, 1)
      const refunded = l.meta.cost
      if (refunded) credits.refund(l.meta.tool, refunded)
      emit(l, { type: 'error', code: 'aborted', message: 'The run was cancelled before it started.' })
      l.meta.status = 'failed'
      l.meta.error = 'The run was cancelled before it started.'
      l.meta.endedAt = new Date().toISOString()
      l.meta.refunded = refunded
      emit(l, { type: 'end', status: 'failed', findings: 0, newFindings: 0, durationMs: 0, refunded })
      finalize(l)
      return
    }
    l.ac.abort()
  }

  function createLive(daemon: DaemonRecord, trigger: 'user' | 'schedule', cost: number, status: RunStatus): Live {
    const runId = crypto.randomUUID()
    const meta: RunMeta = { runId, daemonId: daemon.id, tool: daemon.tool, startedAt: new Date().toISOString(), status, findings: 0, newFindings: 0, cost, trigger, refunded: 0 }
    let resolveFinished!: () => void
    const finished = new Promise<void>((r) => (resolveFinished = r))
    const l: Live = {
      meta,
      events: [],
      daemon: { ...daemon },
      listeners: new Set(),
      ac: new AbortController(),
      finished,
      resolveFinished,
      discarded: false,
      closed: false,
      dirty: true,
      t0: Date.now(),
      start: () => {
        void execute(l)
          .catch((err) => {
            console.error('[run] engine error:', scrub(err instanceof Error ? err.message : String(err)))
            if (!l.closed) {
              l.meta.status = 'failed'
              l.meta.endedAt = new Date().toISOString()
              emit(l, { type: 'error', code: 'internal', message: GENERIC_ERROR })
              emit(l, { type: 'end', status: 'failed', findings: l.meta.findings, newFindings: l.meta.newFindings, durationMs: 0, refunded: 0 })
              finalize(l)
            }
          })
          .finally(() => {
            running--
            pump()
          })
      },
    }
    metas.set(runId, meta)
    return l
  }

  function startRun(daemon: DaemonRecord, trigger: 'user' | 'schedule'): StartResult {
    const active = byDaemonActive.get(daemon.id)
    if (active) return { runId: active, existing: true }

    const cost = costOf(daemon.tool)
    const short = shortfall(daemon.tool)
    if (short || stopped) {
      const l = createLive(daemon, trigger, cost, 'failed')
      const message = short?.message ?? 'The server is shutting down. Try again in a moment.'
      l.meta.error = message
      l.meta.endedAt = l.meta.startedAt
      emit(l, { type: 'start', runId: l.meta.runId, daemonId: daemon.id, tool: daemon.tool, startedAt: l.meta.startedAt, cost })
      emit(l, { type: 'error', code: 'credits', message, action: { kind: 'add-credits', label: 'Add credits' } })
      emit(l, { type: 'end', status: 'failed', findings: 0, newFindings: 0, durationMs: 0, refunded: 0 })
      finalize(l)
      return { runId: l.meta.runId, existing: false, shortfall: short ?? { needed: cost, balance: credits.balance(daemon.tool), message } }
    }

    credits.charge(daemon.tool, cost) // cannot fail: shortfall() just said it is affordable and nothing awaited since
    const queued = running >= maxConcurrent
    const l = createLive(daemon, trigger, cost, queued ? 'queued' : 'running')
    byDaemonActive.set(daemon.id, l.meta.runId)
    live.set(l.meta.runId, l)
    emit(l, { type: 'start', runId: l.meta.runId, daemonId: daemon.id, tool: daemon.tool, startedAt: l.meta.startedAt, cost })
    void persist(l)
    queue.push(l)
    pump()
    return { runId: l.meta.runId, existing: false }
  }

  function stream(req: IncomingMessage, res: ServerResponse, runId: string): void {
    const events = eventsOf(runId)
    if (!events) return sendJson(res, 404, { ok: false, code: 'not-found', message: 'No such run. It may have been deleted with its daemon.' })
    const out = startNdjson(req, res)
    const l = live.get(runId)
    const sent = events.length
    for (let i = 0; i < sent; i++) out.write(events[i])
    if (!l || events.some((e) => e.type === 'end')) return out.end()
    let done = false
    const listener = (e: RunEvent) => {
      if (done) return
      out.write(e)
      if (e.type === 'end') {
        done = true
        out.end()
      }
    }
    l.listeners.add(listener)
    out.signal.addEventListener(
      'abort',
      () => {
        done = true
        l.listeners.delete(listener)
      },
      { once: true },
    )
  }

  return {
    startRun,
    shortfall,
    activeRunId: (daemonId) => byDaemonActive.get(daemonId),
    summaries: (daemonId, limit = KEEP_RUNS) => runsOf(daemonId).slice(0, limit).map(toSummary),
    lastFinished(daemonId) {
      const m = runsOf(daemonId).find((x) => x.status === 'done' || x.status === 'failed')
      return m ? toSummary(m) : undefined
    },
    meta: (runId) => metas.get(runId),
    events: eventsOf,
    latest(daemonId) {
      const id = byDaemonActive.get(daemonId) ?? runsOf(daemonId)[0]?.runId
      if (!id) return null
      const events = eventsOf(id)
      return events ? { runId: id, events: [...events] } : null
    },
    stream,
    async discardDaemon(daemonId) {
      const mine = [...live.values()].filter((l) => l.meta.daemonId === daemonId)
      for (const l of mine) {
        l.discarded = true
        abortLive(l)
      }
      await Promise.all(mine.map((l) => l.finished))
      for (const m of runsOf(daemonId)) {
        metas.delete(m.runId)
        void store.remove(runPath(m.runId))
      }
      memories.delete(daemonId)
      await store.remove(memPath(daemonId))
    },
    async stop() {
      stopped = true
      const all = [...live.values()]
      for (const l of all) abortLive(l)
      await Promise.race([Promise.all(all.map((l) => l.finished)), new Promise((r) => setTimeout(r, 5000))])
      await store.flush()
    },
    async idle() {
      while (live.size > 0) await Promise.all([...live.values()].map((l) => l.finished))
      await store.flush()
    },
    counts: () => ({ running, queued: queue.length }),
  }
}
