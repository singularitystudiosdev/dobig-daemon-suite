import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import { NANO_BANANA_MODEL, VARIANTS_PER_THUMB, type ApiError, type StatusResponse } from '../src/lib/apiTypes.ts'
import { redactKeys, sendJson } from './http.ts'
import { ResolveError, resolveGame } from './roblox.ts'
import { CACHE_DIR, envProvider, handleVariants, serveGeneratedImage, type ServerEnv } from './variants.ts'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'
const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai'

/** JSON API under /api, mounted in both `vite` (dev) and `vite preview`. */
export function apiPlugin(): Plugin {
  let env: ServerEnv = { key: '', baseUrl: DEFAULT_BASE, openrouterKey: '', openrouterBaseUrl: DEFAULT_OPENROUTER_BASE, cacheDir: '' }

  const configure = (config: ResolvedConfig) => {
    const file = loadEnv(config.mode, config.envDir || config.root, '')
    const pick = (name: string) => (process.env[name] ?? file[name] ?? '').trim()
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
    route(req, res, env).catch((err) => {
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
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

async function route(req: IncomingMessage, res: ServerResponse, env: ServerEnv): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://localhost')
  const p = u.pathname.replace(/\/+$/, '')
  const method = req.method ?? 'GET'
  const methodNotAllowed = (allow: string) => sendJson(res, 405, { ok: false, code: 'bad-link', message: `Use ${allow} for this endpoint.` } satisfies ApiError, { allow })

  if (p === '/api/status') {
    if (method !== 'GET') return methodNotAllowed('GET')
    const body: StatusResponse = {
      geminiKey: env.key.length > 0 || env.openrouterKey.length > 0,
      provider: envProvider(env),
      model: NANO_BANANA_MODEL,
      perThumb: VARIANTS_PER_THUMB,
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
    return handleVariants(req, res, env)
  }

  const img = /^\/api\/img\/([^/]+)$/.exec(p)
  if (img) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed('GET')
    return serveGeneratedImage(req, res, env, decodeURIComponent(img[1]))
  }

  sendJson(res, 404, { ok: false, code: 'not-found', message: 'No such API endpoint.' } satisfies ApiError)
}
