import { createHash, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NANO_BANANA_MODEL, VARIANTS_PER_THUMB, type ApiError, type StatusResponse } from '../src/lib/apiTypes.ts'
import { redactKeys, sendJson } from './http.ts'
import { ResolveError, resolveGame } from './roblox.ts'
import { createEngine, type Engine } from './engine.ts'
import { resolveImageKey, resolveLlmKey } from './keys.ts'
import { resolveDataDir } from './store.ts'
import type { Analyzer } from './tools/types.ts'
import { CACHE_DIR, handleVariants, listExistingVariants, serveGeneratedImage, type ServerEnv } from './variants.ts'
import type { DaemonSlug } from '../src/data/daemons.ts'

/* The whole API as one framework-free request handler. The Vite plugin (dev and preview) and the standalone server
   (server/standalone.ts) both mount it, so there is exactly one implementation of /api. It never imports Vite. */

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai'

/** Failed access codes per client IP that are tolerated per minute; the next request answers 429. */
const MAX_FAILURES = 10
const FAILURE_WINDOW_MS = 60_000

/* One engine (credits, secrets, runs, daemons and the scheduler) per process. Vite restarts the config on file
   changes and calls configureServer again: the previous engine is stopped (its runs recorded as aborted) before the
   replacement loads the same data directory, so the scheduler never runs twice. */
const ENGINE_SLOT = Symbol.for('daemon-suite.engine')
interface EngineSlot {
  engine: Engine | null
  ready: Promise<void>
}
const slot = ((globalThis as Record<symbol, unknown>)[ENGINE_SLOT] ??= { engine: null, ready: Promise.resolve() }) as EngineSlot

/** Test switch: DAEMON_FAKE_TOOLS=1 swaps every analyzer except the thumbnail watcher for a deterministic fake;
 *  a comma list of tool slugs swaps exactly those. Ignored when NODE_ENV is production. */
async function fakeAnalyzers(spec: string): Promise<Partial<Record<DaemonSlug, Analyzer>> | undefined> {
  if (!spec || process.env.NODE_ENV === 'production') return undefined
  const { fakeAnalyzers: all } = await import('./test/fake-analyzers.ts')
  if (spec === '1' || spec === 'true') {
    const { 'thumbnail-daemon': _keep, ...rest } = all
    void _keep
    return rest
  }
  const picked: Partial<Record<DaemonSlug, Analyzer>> = {}
  for (const slug of spec.split(',').map((x) => x.trim()) as DaemonSlug[]) if (all[slug]) picked[slug] = all[slug]
  return picked
}

export interface ApiHandlerOptions {
  /** Project root: the default data and cache directories live under it. */
  root: string
  /** Reads a setting (process env, then .env files for the plugin). Returns '' when unset. */
  pick: (name: string) => string
}

export interface ApiHandler {
  /** Answers one request. Never rejects: failures become a 500 body that carries no internals. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>
  /** Starts the process-wide engine, stopping an older one first (Vite hot reload). `httpServer` stops it on close. */
  boot(httpServer?: { once(event: 'close', fn: () => void): unknown } | null): void
  /** Stops this handler's engine and waits until its runs are recorded. */
  stop(): Promise<void>
  /** True when requests need the access code. */
  readonly accessRequired: boolean
}

/** True for /api and everything below it. */
export function isApiUrl(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')
}

export function createApiHandler(options: ApiHandlerOptions): ApiHandler {
  const { pick } = options
  const env: ServerEnv = {
    key: pick('GEMINI_API_KEY'),
    baseUrl: (pick('GEMINI_BASE_URL') || DEFAULT_BASE).replace(/\/+$/, ''),
    openrouterKey: pick('OPENROUTER_API_KEY'),
    openrouterBaseUrl: (pick('OPENROUTER_BASE_URL') || DEFAULT_OPENROUTER_BASE).replace(/\/+$/, ''),
    // DAEMON_CACHE_DIR: where generated images are written; tests point it at a temp dir.
    cacheDir: pick('DAEMON_CACHE_DIR') ? path.resolve(pick('DAEMON_CACHE_DIR')) : path.join(options.root, CACHE_DIR),
  }
  const dataDir = resolveDataDir(options.root, pick('DAEMON_DATA_DIR'))
  const requestsWebhook = pick('REQUESTS_WEBHOOK_URL') !== ''
  const gate = createGate(pick('API_ACCESS_CODE'), pick('TRUST_PROXY') === '1')
  const cors = pick('CORS_ORIGIN')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o && o !== '*')
  const allowedOrigins = new Set(cors)
  let mine: Engine | null = null

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const live = slot.engine
    try {
      if (applyCors(req, res)) return
      if (gate.enabled && !gate.admit(req, res)) return
      await slot.ready
      const engine = slot.engine ?? live
      if (!engine) throw new Error('The engine is not running.')
      if (await engine.handle(req, res)) return
      await route(req, res, env, engine)
    } catch (err) {
      // Never echo internals (or a key) to the client.
      console.error('[api] unhandled:', redactKeys(err instanceof Error ? err.message : String(err), env.key || env.openrouterKey))
      const body: ApiError = { ok: false, code: 'upstream', message: 'The local API hit an unexpected error. Reload and try again.' }
      sendJson(res, 500, body)
    }
  }

  /** Adds CORS headers for an allowed origin and answers a preflight. Returns true when the request is finished. */
  function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
    if (allowedOrigins.size === 0) return false
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowedOrigins.has(origin)) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('access-control-expose-headers', 'retry-after')
      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-headers', 'authorization, content-type')
        res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS')
        res.setHeader('access-control-max-age', '600')
      }
    }
    res.setHeader('vary', 'Origin')
    if (req.method !== 'OPTIONS') return false
    res.statusCode = 204
    res.setHeader('content-length', '0')
    res.end()
    return true
  }

  function boot(httpServer?: { once(event: 'close', fn: () => void): unknown } | null): void {
    const previous = slot.engine
    slot.engine = null
    const spec = pick('DAEMON_FAKE_TOOLS')
    slot.ready = (async () => {
      await previous?.stop().catch(() => undefined)
      const analyzers = await fakeAnalyzers(spec)
      const created = createEngine({ dataDir, env: pick, analyzers })
      mine = created
      slot.engine = created
      created.start()
    })().catch((err) => console.error('[engine] failed to start:', err instanceof Error ? err.message : String(err)))
    httpServer?.once('close', () => void stop())
  }

  async function stop(): Promise<void> {
    await slot.ready
    const eng = mine
    mine = null
    if (eng && slot.engine === eng) slot.engine = null
    await eng?.stop().catch(() => undefined)
  }

  return { handle, boot, stop, accessRequired: gate.enabled }

  async function route(req: IncomingMessage, res: ServerResponse, serverEnv: ServerEnv, engine: Engine): Promise<void> {
    const u = new URL(req.url ?? '/', 'http://localhost')
    const p = u.pathname.replace(/\/+$/, '')
    const method = req.method ?? 'GET'
    const methodNotAllowed = (allow: string) => sendJson(res, 405, { ok: false, code: 'bad-link', message: `Use ${allow} for this endpoint.` } satisfies ApiError, { allow })

    if (p === '/api/status') {
      if (method !== 'GET') return methodNotAllowed('GET')
      const image = resolveImageKey('', serverEnv, engine.secrets)
      // `llm` is an extra property: StatusResponse (src/lib/apiTypes.ts) is read-only and predates it.
      const body: StatusResponse & { llm: boolean } = {
        geminiKey: image !== null,
        provider: image?.provider ?? null,
        model: NANO_BANANA_MODEL,
        perThumb: VARIANTS_PER_THUMB,
        llm: resolveLlmKey(serverEnv, engine.secrets) !== '',
        requestsWebhook,
        accessRequired: gate.enabled,
      }
      return sendJson(res, 200, body)
    }

    if (p === '/api/game') {
      if (method !== 'GET') return methodNotAllowed('GET')
      const link = u.searchParams.get('link') ?? ''
      try {
        return sendJson(res, 200, await resolveGame(link))
      } catch (err) {
        if (err instanceof ResolveError) {
          const headers: Record<string, string> = {}
          if (err.retryAfter !== undefined) headers['retry-after'] = String(err.retryAfter)
          return sendJson(res, err.status, err.toBody(), headers)
        }
        throw err
      }
    }

    if (p === '/api/variants') {
      if (method !== 'POST') return methodNotAllowed('POST')
      return handleVariants(req, res, serverEnv, { credits: engine.credits, secrets: engine.secrets })
    }

    if (p === '/api/variants/existing') {
      if (method !== 'GET') return methodNotAllowed('GET')
      return listExistingVariants(res, serverEnv, u.searchParams.get('ids') ?? '')
    }

    const img = /^\/api\/img\/([^/]+)$/.exec(p)
    if (img) {
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed('GET')
      return serveGeneratedImage(req, res, serverEnv, decodeURIComponent(img[1]))
    }

    sendJson(res, 404, { ok: false, code: 'not-found', message: 'No such API endpoint.' } satisfies ApiError)
  }
}

/* ---- access gate ---- */

const sha256 = (value: string) => createHash('sha256').update(value).digest()

interface Gate {
  enabled: boolean
  /** Returns true when the request may continue; otherwise it has been answered with 401 or 429. */
  admit(req: IncomingMessage, res: ServerResponse): boolean
}

/** Bearer-code check. Only a wrong code counts as a failure (a visitor who has not typed one yet fires several
 *  requests without a header, and must not be locked out by their own page load). */
function createGate(code: string, trustProxy: boolean): Gate {
  if (!code) return { enabled: false, admit: () => true }
  const expected = sha256(code)
  const failures = new Map<string, number[]>()

  const clientIp = (req: IncomingMessage): string => {
    if (trustProxy) {
      const fwd = req.headers['x-forwarded-for']
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
      if (first) return first
    }
    return req.socket.remoteAddress ?? 'unknown'
  }

  const recent = (ip: string, now: number): number[] => {
    const kept = (failures.get(ip) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS)
    if (kept.length) failures.set(ip, kept)
    else failures.delete(ip)
    return kept
  }

  const sweep = (now: number) => {
    if (failures.size < 1000) return
    for (const ip of [...failures.keys()]) recent(ip, now)
  }

  const open = (req: IncomingMessage): boolean => {
    if (req.method === 'OPTIONS') return true
    if (req.method !== 'GET') return false
    const p = (req.url ?? '').split('?')[0].replace(/\/+$/, '')
    // Status is how the page learns a code is needed. Generated images are fetched by <img>, which cannot send a
    // header; they are cached copies of public Roblox thumbnails and cost nothing to read.
    return p === '/api/status' || /^\/api\/img\/[^/]+$/.test(p)
  }

  return {
    enabled: true,
    admit(req, res) {
      if (open(req)) return true
      const now = Date.now()
      const ip = clientIp(req)
      const past = recent(ip, now)
      if (past.length >= MAX_FAILURES) {
        const retry = Math.max(1, Math.ceil((past[0] + FAILURE_WINDOW_MS - now) / 1000))
        const body: ApiError = { ok: false, code: 'rate-limited', message: 'Too many wrong access codes. Wait a minute and try again.' }
        sendJson(res, 429, body, { 'retry-after': String(retry) })
        return false
      }
      const header = req.headers.authorization
      const match = typeof header === 'string' ? /^Bearer\s+(.*)$/i.exec(header) : null
      const ok = match !== null && timingSafeEqual(sha256(match[1].trim()), expected)
      if (ok) return true
      if (match !== null) {
        sweep(now)
        failures.set(ip, [...past, now])
      }
      const body = { ok: false, code: 'access', message: 'Enter the access code to use this server.' }
      sendJson(res, 401, body, { 'www-authenticate': 'Bearer' })
      return false
    },
  }
}
