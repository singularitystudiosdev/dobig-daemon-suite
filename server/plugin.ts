import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import { NANO_BANANA_MODEL, VARIANTS_PER_THUMB, type ApiError, type StatusResponse } from '../src/lib/apiTypes.ts'
import { redactKeys, sendJson } from './http.ts'
import { ResolveError, resolveGame } from './roblox.ts'
import { createEngine, type Engine } from './engine.ts'
import { resolveImageKey, resolveLlmKey } from './keys.ts'
import { resolveDataDir } from './store.ts'
import type { Analyzer } from './tools/types.ts'
import { CACHE_DIR, handleVariants, listExistingVariants, serveGeneratedImage, type ServerEnv } from './variants.ts'
import type { DaemonSlug } from '../src/data/daemons.ts'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai'

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

/** JSON API under /api, mounted in both `vite` (dev) and `vite preview`. */
export function apiPlugin(): Plugin {
  let env: ServerEnv = { key: '', baseUrl: DEFAULT_BASE, openrouterKey: '', openrouterBaseUrl: DEFAULT_OPENROUTER_BASE, cacheDir: '' }
  let pickEnv: (name: string) => string = () => ''
  let dataDir = ''

  const configure = (config: ResolvedConfig) => {
    const file = loadEnv(config.mode, config.envDir || config.root, '')
    const pick = (name: string) => (process.env[name] ?? file[name] ?? '').trim()
    pickEnv = pick
    dataDir = resolveDataDir(config.root, pick('DAEMON_DATA_DIR'))
    env = {
      key: pick('GEMINI_API_KEY'),
      baseUrl: (pick('GEMINI_BASE_URL') || DEFAULT_BASE).replace(/\/+$/, ''),
      openrouterKey: pick('OPENROUTER_API_KEY'),
      openrouterBaseUrl: (pick('OPENROUTER_BASE_URL') || DEFAULT_OPENROUTER_BASE).replace(/\/+$/, ''),
      // DAEMON_CACHE_DIR: where generated images are written; tests point it at a temp dir.
      cacheDir: pick('DAEMON_CACHE_DIR') ? path.resolve(pick('DAEMON_CACHE_DIR')) : path.join(config.root, CACHE_DIR),
    }
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const url = req.url ?? ''
    if (!(url === '/api' || url.startsWith('/api/') || url.startsWith('/api?'))) return next()
    const live = slot.engine
    const run = async () => {
      await slot.ready
      const engine = slot.engine ?? live
      if (!engine) throw new Error('The engine is not running.')
      if (await engine.handle(req, res)) return
      await route(req, res, env, engine)
    }
    run().catch((err) => {
      // Never echo internals (or a key) to the client.
      console.error('[api] unhandled:', redactKeys(err instanceof Error ? err.message : String(err), env.key || env.openrouterKey))
      const body: ApiError = { ok: false, code: 'upstream', message: 'The local API hit an unexpected error. Reload and try again.' }
      sendJson(res, 500, body)
    })
  }

  return {
    name: 'thumbnail-demo-api',
    configResolved: configure,
    configureServer(server) {
      boot(server.httpServer)
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      boot(server.httpServer)
      server.middlewares.use(handler)
    },
  }

  function boot(httpServer: { once(event: 'close', fn: () => void): unknown } | null): void {
    const previous = slot.engine
    slot.engine = null
    const pickNow = pickEnv
    const dir = dataDir
    const spec = pickNow('DAEMON_FAKE_TOOLS')
    let mine: Engine | null = null
    slot.ready = (async () => {
      await previous?.stop().catch(() => undefined)
      const analyzers = await fakeAnalyzers(spec)
      mine = createEngine({ dataDir: dir, env: pickNow, analyzers })
      slot.engine = mine
      mine.start()
    })().catch((err) => console.error('[engine] failed to start:', err instanceof Error ? err.message : String(err)))
    httpServer?.once('close', () => {
      const eng = mine
      if (eng && slot.engine === eng) slot.engine = null
      void eng?.stop()
    })
  }
}

async function route(req: IncomingMessage, res: ServerResponse, env: ServerEnv, engine: Engine): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://localhost')
  const p = u.pathname.replace(/\/+$/, '')
  const method = req.method ?? 'GET'
  const methodNotAllowed = (allow: string) => sendJson(res, 405, { ok: false, code: 'bad-link', message: `Use ${allow} for this endpoint.` } satisfies ApiError, { allow })

  if (p === '/api/status') {
    if (method !== 'GET') return methodNotAllowed('GET')
    const image = resolveImageKey('', env, engine.secrets)
    // `llm` is an extra property: StatusResponse (src/lib/apiTypes.ts) is read-only and predates it.
    const body: StatusResponse & { llm: boolean } = {
      geminiKey: image !== null,
      provider: image?.provider ?? null,
      model: NANO_BANANA_MODEL,
      perThumb: VARIANTS_PER_THUMB,
      llm: resolveLlmKey(env, engine.secrets) !== '',
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
    return handleVariants(req, res, env, { credits: engine.credits, secrets: engine.secrets })
  }

  if (p === '/api/variants/existing') {
    if (method !== 'GET') return methodNotAllowed('GET')
    return listExistingVariants(res, env, u.searchParams.get('ids') ?? '')
  }

  const img = /^\/api\/img\/([^/]+)$/.exec(p)
  if (img) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed('GET')
    return serveGeneratedImage(req, res, env, decodeURIComponent(img[1]))
  }

  sendJson(res, 404, { ok: false, code: 'not-found', message: 'No such API endpoint.' } satisfies ApiError)
}
