import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApiHandler, isApiUrl } from './handler.ts'

/* A plain node:http server for hosting: the built frontend from dist/ and the whole API on one port.
   Run it with `npm start` (Node 24 runs the TypeScript directly). Settings come from the process environment:
   PORT (8080), HOST (0.0.0.0), API_ACCESS_CODE, ALLOW_OPEN_API, CORS_ORIGIN, TRUST_PROXY, plus everything the API reads
   (OPENROUTER_API_KEY, REQUESTS_WEBHOOK_URL, DAEMON_DATA_DIR, DAEMON_CACHE_DIR). See docs/hosting.md. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

export class AccessCodeRequiredError extends Error {
  constructor() {
    super('API_ACCESS_CODE is not set. Without it anyone who finds this server can spend your keys. Set API_ACCESS_CODE to a long random string, or set ALLOW_OPEN_API=1 to run it open on purpose.')
    this.name = 'AccessCodeRequiredError'
  }
}

export interface StandaloneOptions {
  /** Settings by name; defaults to process.env. */
  env?: Record<string, string | undefined>
  /** The built frontend. Defaults to <project>/dist. */
  distDir?: string
  /** Project root for the default data and cache directories. */
  root?: string
  /** Overrides PORT. 0 picks a free port. */
  port?: number
  /** Overrides HOST. */
  host?: string
}

export interface StandaloneServer {
  server: http.Server
  port: number
  /** Stops accepting connections, stops the engine (runs recorded as aborted) and closes what is left. */
  close(): Promise<void>
}

export async function startServer(options: StandaloneOptions = {}): Promise<StandaloneServer> {
  const source = options.env ?? process.env
  const pick = (name: string) => (source[name] ?? '').trim()
  if (!pick('API_ACCESS_CODE') && pick('ALLOW_OPEN_API') !== '1') throw new AccessCodeRequiredError()

  const distDir = path.resolve(options.distDir ?? path.join(ROOT, 'dist'))
  const api = createApiHandler({ root: options.root ?? ROOT, pick })
  const server = http.createServer((req, res) => {
    if (isApiUrl(req.url ?? '')) return void api.handle(req, res)
    serveStatic(req, res, distDir)
  })
  // Hosts put a proxy in front with a 60 s idle timeout; stay above it so a reused socket is never reset.
  server.keepAliveTimeout = 65_000
  api.boot(server)

  const port = options.port ?? (Number(pick('PORT')) || 8080)
  const host = options.host ?? (pick('HOST') || '0.0.0.0')
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  let closing: Promise<void> | null = null
  const close = () =>
    (closing ??= (async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeIdleConnections()
      await Promise.race([api.stop(), new Promise((resolve) => setTimeout(resolve, 8000).unref())])
      server.closeAllConnections()
      await closed
    })())

  return { server, port: (server.address() as AddressInfo).port, close }
}

/* ---- static files ---- */

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, distDir: string): void {
  const fail = (status: number, message: string) => {
    res.statusCode = status
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(message)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD')
    return fail(405, 'Method not allowed.')
  }

  let decoded: string
  try {
    decoded = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0])
  } catch {
    return fail(400, 'Bad request.')
  }
  // Refuse anything that could leave dist/ before the path is ever normalised.
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return fail(403, 'Forbidden.')

  const rel = decoded.replace(/^\/+/, '')
  const wanted = path.join(distDir, rel)
  if (wanted !== distDir && !wanted.startsWith(distDir + path.sep)) return fail(403, 'Forbidden.')

  const index = path.join(distDir, 'index.html')
  const resolved = firstFile([wanted, path.join(wanted, 'index.html')])
  let file = resolved
  if (!file) {
    // A request for a file that is not there is a 404 (never an HTML page in place of a script); any other unknown
    // path is a client-side route and gets the app.
    if (path.extname(decoded) !== '') return fail(404, 'Not found.')
    file = firstFile([index])
    if (!file) return fail(404, 'The frontend is not built. Run npm run build first.')
  }

  const stat = fs.statSync(file)
  const ext = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream')
  res.setHeader('content-length', stat.size)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cache-control', cacheControl(distDir, file))
  if (req.method === 'HEAD') return void res.end()
  pipeline(fs.createReadStream(file), res, () => undefined)
}

function firstFile(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch {
      /* try the next */
    }
  }
  return null
}

/** Hashed bundles never change, so they are cached for a year; everything else is revalidated or cached briefly. */
function cacheControl(distDir: string, file: string): string {
  const rel = path.relative(distDir, file).split(path.sep).join('/')
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable'
  if (rel.endsWith('.html')) return 'no-cache'
  return 'public, max-age=3600'
}

/* ---- entry ---- */

async function main(): Promise<void> {
  let running: StandaloneServer
  try {
    running = await startServer()
  } catch (err) {
    console.error(err instanceof AccessCodeRequiredError ? err.message : `Could not start the server: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
  const gated = Boolean((process.env.API_ACCESS_CODE ?? '').trim())
  console.log(`Daemon suite listening on port ${running.port}${gated ? ' (access code required)' : ' (OPEN: no access code)'}`)

  const stop = (signal: string) => {
    console.log(`${signal} received, stopping`)
    const force = setTimeout(() => process.exit(1), 12_000)
    force.unref()
    void running.close().then(() => process.exit(0))
  }
  process.once('SIGTERM', () => stop('SIGTERM'))
  process.once('SIGINT', () => stop('SIGINT'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
