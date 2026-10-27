import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DaemonSlug } from '../src/data/daemons.ts'
import { tools } from '../src/data/tools.ts'
import { createCredits, type Credits } from './credits.ts'
import { createDaemons, type Daemons, type Route } from './daemons.ts'
import { BodyError, redactKeys, sendJson } from './http.ts'
import { resolveLlmKey, type KeyEnv } from './keys.ts'
import { cleanRequest, createRequests, RequestsError, type Requests } from './requests.ts'
import { createLlm, DEFAULT_ANALYSIS_MODEL, type Llm } from './llm.ts'
import { createRunEngine, type RunEngine } from './runs.ts'
import { cleanSecretValue, createSecrets, isSecretName, type SecretStore } from './secrets.ts'
import { createStore, type Store } from './store.ts'
import { toolModules } from './tools/index.ts'
import { RunError, type Analyzer, type RouteContext, type RouteHandler } from './tools/types.ts'
import { watchThumbnails } from './watch-thumbnails.ts'
import type { describeTarget } from './targets.ts'

/* Assembles the server backbone around one data directory: store, credits, secrets, the run engine, the daemons and
   their scheduler, and the HTTP routes for all of them plus every tool's own routes. The plugin creates exactly one
   per process; tests create their own with fake analyzers injected. */

const MAX_BODY = 256 * 1024
const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai'

export interface EngineOptions {
  dataDir: string
  /** Reads a setting (process env, then .env files). Defaults to process.env. */
  env?: (name: string) => string
  /** Replaces the real analyzer of a tool (tests only). */
  analyzers?: Partial<Record<DaemonSlug, Analyzer>>
  tickMs?: number
  maxConcurrent?: number
  describe?: typeof describeTarget
  /** Lowest interval a request may set, in hours (default 0.001). Tests only. */
  minIntervalHours?: number
}

export interface Engine {
  store: Store
  credits: Credits
  secrets: SecretStore
  requests: Requests
  runs: RunEngine
  daemons: Daemons
  keyEnv(): KeyEnv
  /** A fresh LLM client from the keys as they are right now. */
  makeLlm(): Llm
  /** Serves the engine's routes. Resolves false when the path is not one of them (the caller continues). */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  /** Starts the scheduler. */
  start(): void
  /** Stops the scheduler, cancels running runs (recorded as aborted, refunded when empty) and flushes the store. */
  stop(): Promise<void>
}

interface Compiled {
  method: string
  re: RegExp
  names: string[]
  handler: (ctx: RouteContext, params: Record<string, string>) => Promise<void>
}

function compile(method: string, path: string, handler: Compiled['handler']): Compiled {
  const names: string[] = []
  const src = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1))
        return '([^/]+)'
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { method, re: new RegExp(`^${src}$`), names, handler }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_BODY) throw new BodyError(413, 'Request body is too large.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) throw new BodyError(413, 'Request body is too large.')
    chunks.push(buf)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (!body.trim()) return undefined
  try {
    return JSON.parse(body)
  } catch {
    throw new BodyError(400, 'The request body is not valid JSON.')
  }
}

export function createEngine(options: EngineOptions): Engine {
  const env = options.env ?? ((name: string) => (process.env[name] ?? '').trim())
  const store = createStore(options.dataDir)
  const credits = createCredits(store)
  const secrets = createSecrets(store)
  const requests = createRequests({ store, webhookUrl: env('REQUESTS_WEBHOOK_URL') })
  const keyEnv = (): KeyEnv => ({ key: env('GEMINI_API_KEY'), openrouterKey: env('OPENROUTER_API_KEY') })
  const makeLlm = (): Llm =>
    createLlm({
      key: resolveLlmKey(keyEnv(), secrets),
      baseUrl: (env('OPENROUTER_BASE_URL') || DEFAULT_OPENROUTER_BASE).replace(/\/+$/, ''),
      model: env('ANALYSIS_MODEL') || DEFAULT_ANALYSIS_MODEL,
    })

  const analyzerFor = (tool: DaemonSlug): Analyzer => {
    const injected = options.analyzers?.[tool]
    if (injected) return injected
    if (tool === 'thumbnail-daemon') return watchThumbnails
    return toolModules[tool].analyze
  }

  let daemons!: Daemons
  const runs = createRunEngine({
    store,
    credits,
    secrets,
    makeLlm,
    analyzerFor,
    maxConcurrent: options.maxConcurrent,
    onRunEnd: (daemonId, endedAt) => daemons.onRunEnd(daemonId, endedAt),
  })
  daemons = createDaemons({ store, runs, describe: options.describe, discordApiBase: env('DISCORD_API_BASE') || undefined, defaultIntervalHours: Number(env('DAEMON_INTERVAL_HOURS')) || undefined, minIntervalHours: options.minIntervalHours })

  const slugs = new Set<string>(tools.map((t) => t.slug))
  const bad = (ctx: RouteContext, message: string, code = 'bad-input', status = 400) => ctx.json(status, { ok: false, code, message })

  const builtin: Route[] = [
    { method: 'GET', path: '/api/credits', handler: async (ctx) => ctx.json(200, credits.response()) },
    {
      method: 'POST',
      path: '/api/credits/topup',
      async handler(ctx) {
        const body = await ctx.body()
        const tool = (body as { tool?: unknown } | undefined)?.tool
        if (typeof tool !== 'string' || !slugs.has(tool)) return bad(ctx, 'Unknown tool.')
        credits.topUp(tool as DaemonSlug)
        ctx.json(200, credits.response())
      },
    },
    { method: 'GET', path: '/api/requests', handler: async (ctx) => ctx.json(200, { requests: requests.list() }) },
    {
      method: 'POST',
      path: '/api/requests',
      async handler(ctx) {
        const clean = cleanRequest(await ctx.body(), slugs)
        if ('error' in clean) return bad(ctx, clean.error)
        try {
          ctx.json(201, { ok: true, request: await requests.add(clean.value) })
        } catch (err) {
          if (err instanceof RequestsError) return bad(ctx, err.message, err.code, 429)
          throw err
        }
      },
    },
    { method: 'GET', path: '/api/secrets', handler: async (ctx) => ctx.json(200, { secrets: secrets.presence() }) },
    {
      method: 'POST',
      path: '/api/secrets',
      async handler(ctx) {
        const body = await ctx.body()
        const o = (body && typeof body === 'object' ? body : {}) as { name?: unknown; value?: unknown }
        if (!isSecretName(o.name)) return bad(ctx, 'Unknown secret name.')
        const clean = cleanSecretValue(o.value)
        if ('error' in clean) return bad(ctx, clean.error)
        await secrets.set(o.name, clean.value)
        ctx.json(200, { ok: true })
      },
    },
    {
      method: 'DELETE',
      path: '/api/secrets/:name',
      async handler(ctx, { name }) {
        if (!isSecretName(name)) return bad(ctx, 'Unknown secret name.')
        await secrets.remove(name)
        ctx.json(200, { ok: true })
      },
    },
    {
      method: 'GET',
      path: '/api/runs/:runId/events',
      async handler(ctx, { runId }) {
        if (!/^[A-Za-z0-9-]{1,64}$/.test(runId)) return bad(ctx, 'No such run.', 'not-found', 404)
        runs.stream(ctx.req, ctx.res, runId)
      },
    },
  ]

  const compiled: Compiled[] = [...builtin, ...daemons.routes].map((r) => compile(r.method, r.path, r.handler))
  for (const mod of Object.values(toolModules)) {
    for (const [key, handler] of Object.entries(mod.routes ?? {}) as [string, RouteHandler][]) {
      const space = key.indexOf(' ')
      if (space < 1) continue
      compiled.push(compile(key.slice(0, space).toUpperCase(), key.slice(space + 1), (ctx) => handler(ctx)))
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const hits = compiled.filter((c) => c.re.test(path))
    if (hits.length === 0) return false
    const method = req.method ?? 'GET'
    const hit = hits.find((c) => c.method === method)
    if (!hit) {
      const allow = [...new Set(hits.map((h) => h.method))].join(', ')
      sendJson(res, 405, { ok: false, code: 'bad-input', message: `Use ${allow} for this endpoint.` }, { allow })
      return true
    }
    const m = hit.re.exec(path)!
    const params: Record<string, string> = {}
    hit.names.forEach((n, i) => {
      try {
        params[n] = decodeURIComponent(m[i + 1])
      } catch {
        params[n] = m[i + 1]
      }
    })
    const ctx: RouteContext = {
      req,
      res,
      url,
      body: () => readBody(req),
      json: (status, data) => sendJson(res, status, data),
      secrets,
    }
    try {
      await hit.handler(ctx, params)
    } catch (err) {
      if (err instanceof BodyError) sendJson(res, err.status, { ok: false, code: 'bad-input', message: err.message })
      else if (err instanceof RunError) sendJson(res, 400, { ok: false, code: err.code, message: secrets.scrub(err.message) })
      else {
        console.error('[api] handler failed:', secrets.scrub(redactKeys(err instanceof Error ? err.message : String(err))))
        sendJson(res, 500, { ok: false, code: 'internal', message: 'The local API hit an unexpected error. Reload and try again.' })
      }
    }
    return true
  }

  let stopped = false
  return {
    store,
    credits,
    secrets,
    requests,
    runs,
    daemons,
    keyEnv,
    makeLlm,
    handle,
    start() {
      const ms = options.tickMs ?? (Number(env('DAEMON_TICK_MS')) || 30_000)
      daemons.startScheduler(ms)
    },
    async stop() {
      if (stopped) return
      stopped = true
      daemons.stopScheduler()
      await runs.stop()
    },
  }
}
