import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import { NANO_BANANA_MODEL, VARIANTS_PER_THUMB, type ApiError, type StatusResponse } from '../src/lib/apiTypes.ts'
import { sendJson } from './http.ts'
import { ResolveError, resolveGame } from './roblox.ts'
import { CACHE_DIR, handleVariants, serveCachedImage, type ServerEnv } from './variants.ts'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com'

/** JSON API under /api, mounted in both `vite` (dev) and `vite preview`. */
export function apiPlugin(): Plugin {
  let env: ServerEnv = { key: '', baseUrl: DEFAULT_BASE, recordedDir: '', cacheDir: '' }

  const configure = (config: ResolvedConfig) => {
    const file = loadEnv(config.mode, config.envDir || config.root, '')
    const pick = (name: string) => (process.env[name] ?? file[name] ?? '').trim()
    env = {
      key: pick('GEMINI_API_KEY'),
      baseUrl: (pick('GEMINI_BASE_URL') || DEFAULT_BASE).replace(/\/+$/, ''),
      recordedDir: path.join(config.publicDir || path.join(config.root, 'public'), 'recorded'),
      // DAEMON_CACHE_DIR lets tests keep their output out of the real cache, which beats recorded sets when it has a file.
      cacheDir: pick('DAEMON_CACHE_DIR') ? path.resolve(pick('DAEMON_CACHE_DIR')) : path.join(config.root, CACHE_DIR),
    }
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const url = req.url ?? ''
    if (!(url === '/api' || url.startsWith('/api/') || url.startsWith('/api?'))) return next()
    route(req, res, env).catch((err) => {
      // Never echo internals (or a key) to the client.
      console.error('[api] unhandled:', redact(err instanceof Error ? err.message : String(err), env.key))
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

function redact(text: string, key: string): string {
  return key ? text.split(key).join('[redacted]') : text
}

export function recordedIds(dir: string): string[] {
  let files: string[]
  try {
    files = fs.readdirSync(dir)
  } catch {
    return []
  }
  const have = new Set(files)
  const ids = new Set<string>()
  for (const f of files) {
    const m = /^(\d+)-0\.jpg$/.exec(f)
    if (!m) continue
    let all = true
    for (let i = 1; i < VARIANTS_PER_THUMB; i++) if (!have.has(`${m[1]}-${i}.jpg`)) all = false
    if (all) ids.add(m[1])
  }
  return [...ids].sort()
}

async function route(req: IncomingMessage, res: ServerResponse, env: ServerEnv): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://localhost')
  const p = u.pathname.replace(/\/+$/, '')
  const method = req.method ?? 'GET'
  const methodNotAllowed = (allow: string) => sendJson(res, 405, { ok: false, code: 'bad-link', message: `Use ${allow} for this endpoint.` } satisfies ApiError, { allow })

  if (p === '/api/status') {
    if (method !== 'GET') return methodNotAllowed('GET')
    const body: StatusResponse = {
      geminiKey: env.key.length > 0,
      model: NANO_BANANA_MODEL,
      recorded: recordedIds(env.recordedDir),
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
    return serveCachedImage(req, res, env, decodeURIComponent(img[1]))
  }

  sendJson(res, 404, { ok: false, code: 'not-found', message: 'No such API endpoint.' } satisfies ApiError)
}
