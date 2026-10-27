import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  NANO_BANANA_MODEL,
  OPENROUTER_MODEL,
  VARIANTS_PER_THUMB,
  VARIANT_PROMPT,
  type ApiError,
  type GalleryThumb,
  type ImageProvider,
  type VariantEvent,
  type VariantFailure,
  type VariantRequest,
} from '../src/lib/apiTypes.ts'
import { GeminiError, generateVariant, sniff } from './gemini.ts'
import { BodyError, readJson, redactKeys, sendJson, startNdjson } from './http.ts'
import { generateWithOpenRouter } from './openrouter.ts'

/** Default output directory for generated images; /api/img serves them to the browser. */
export const CACHE_DIR = '.cache/variants'
const MAX_BODY = 256 * 1024
const CONCURRENCY = 3
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const MAX_THUMB_BYTES = 8 * 1024 * 1024

export interface ServerEnv {
  /** Server-side Gemini key (env). Never logged or sent to the client. */
  key: string
  baseUrl: string
  /** Server-side OpenRouter key (env). Used only when there is no Gemini key. Never logged or sent to the client. */
  openrouterKey: string
  openrouterBaseUrl: string
  /** Where generated images are written (and served from by /api/img). Never read to skip a generation. */
  cacheDir: string
}

interface Tile {
  thumb: GalleryThumb
  index: number
}

function invalid(res: ServerResponse, message: string, status = 400): void {
  sendJson(res, status, { ok: false, code: 'bad-link', message } satisfies ApiError)
}

/** Validates the body; returns an error message or the parsed request. */
export function parseVariantRequest(raw: unknown): { error: string } | { gallery: GalleryThumb[]; perThumb: number; tiles: Tile[] } {
  if (!raw || typeof raw !== 'object') return { error: 'Send a JSON object with a gallery array.' }
  const body = raw as Partial<VariantRequest>
  if (!Array.isArray(body.gallery) || body.gallery.length < 1 || body.gallery.length > 12) {
    return { error: 'gallery must list between 1 and 12 thumbnails.' }
  }
  const gallery: GalleryThumb[] = []
  const seen = new Set<string>()
  for (const g of body.gallery) {
    const id = (g as GalleryThumb | null)?.id
    const url = (g as GalleryThumb | null)?.url
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) return { error: 'Every gallery id must be digits.' }
    if (typeof url !== 'string' || url.length > 2048) return { error: 'Every gallery entry needs a url.' }
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return { error: 'Every gallery url must be a valid URL.' }
    }
    if (u.protocol !== 'https:' || u.hostname !== 'tr.rbxcdn.com' || u.username || u.password || u.port) {
      return { error: 'Gallery images must come from https://tr.rbxcdn.com.' }
    }
    if (seen.has(id)) continue
    seen.add(id)
    gallery.push({ id, url: u.toString() })
  }
  let perThumb = VARIANTS_PER_THUMB
  if (body.perThumb !== undefined) {
    if (!Number.isInteger(body.perThumb) || body.perThumb < 1 || body.perThumb > VARIANTS_PER_THUMB) {
      return { error: `perThumb must be a whole number from 1 to ${VARIANTS_PER_THUMB}.` }
    }
    perThumb = body.perThumb
  }
  let tiles: Tile[] = []
  for (const thumb of gallery) for (let index = 0; index < perThumb; index++) tiles.push({ thumb, index })
  if (body.only !== undefined) {
    if (!Array.isArray(body.only) || body.only.length > 64) return { error: 'only must be a list of {thumbId, index}.' }
    const want = new Set<string>()
    for (const o of body.only) {
      if (!o || typeof o.thumbId !== 'string' || !Number.isInteger(o.index)) return { error: 'only must be a list of {thumbId, index}.' }
      want.add(`${o.thumbId}-${o.index}`)
    }
    tiles = tiles.filter((t) => want.has(`${t.thumb.id}-${t.index}`))
  }
  return { gallery, perThumb, tiles }
}

const KEY_SHAPE = /^[A-Za-z0-9_-]{6,256}$/
const OPENROUTER_PREFIX = 'sk-or-'

/** The provider a browser-supplied key belongs to: OpenRouter keys start with sk-or-, anything else is a Gemini key. */
export function providerForKey(key: string): ImageProvider {
  return key.startsWith(OPENROUTER_PREFIX) ? 'openrouter' : 'google'
}

/** The provider the server's own environment keys select (a Gemini key wins when both are set), or null with none. */
export function envProvider(env: ServerEnv): ImageProvider | null {
  if (env.key) return 'google'
  if (env.openrouterKey) return 'openrouter'
  return null
}

/** `?v=` busts the immutable browser cache when a new generation overwrites the same filename. */
function imgSrc(env: ServerEnv, name: string): string {
  let v = 0
  try {
    v = Math.floor(fs.statSync(path.join(env.cacheDir, name)).mtimeMs)
  } catch {
    /* served without a version */
  }
  return `/api/img/${name}?v=${v}`
}

async function downloadThumb(url: string, signal: AbortSignal): Promise<{ mime: string; base64: string }> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: 'error' })
  } catch {
    if (signal.aborted) throw signal.reason
    throw new GeminiError('upstream', 'Could not download the Roblox screenshot. Retry this tile.')
  }
  if (!res.ok) throw new GeminiError('upstream', 'Roblox no longer serves that screenshot. Paste the game link again to refresh it.')
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_THUMB_BYTES) throw new GeminiError('upstream', 'That screenshot is too large to edit.')
  const mime = sniff(bytes)
  if (!mime) throw new GeminiError('upstream', 'Roblox returned something that is not an image. Paste the game link again.')
  return { mime, base64: bytes.toString('base64') }
}

export async function handleVariants(req: IncomingMessage, res: ServerResponse, env: ServerEnv): Promise<void> {
  let raw: unknown
  try {
    raw = await readJson(req, MAX_BODY)
  } catch (err) {
    if (err instanceof BodyError) return invalid(res, err.message, err.status)
    throw err
  }
  const parsed = parseVariantRequest(raw)
  if ('error' in parsed) return invalid(res, parsed.error)

  // A key typed into the browser wins over the one in the server environment.
  const header = req.headers['x-gemini-key']
  const headerKey = (Array.isArray(header) ? header[0] : header)?.trim() ?? ''
  let apiKey = ''
  let provider: ImageProvider | null = null
  if (headerKey && KEY_SHAPE.test(headerKey)) {
    apiKey = headerKey
    provider = providerForKey(headerKey)
  } else {
    provider = envProvider(env)
    apiKey = provider === 'google' ? env.key : provider === 'openrouter' ? env.openrouterKey : ''
  }
  const { tiles } = parsed
  // Every tile is a fresh call to the model; with no key anywhere nothing is generated.
  const mode: 'live' | 'unavailable' = apiKey ? 'live' : 'unavailable'
  if (mode === 'unavailable') provider = null

  const out = startNdjson(req, res)
  const emit = (e: VariantEvent) => out.write(e)
  let done = 0
  let failed = 0
  emit({ type: 'start', total: tiles.length, mode, model: NANO_BANANA_MODEL, provider })

  const thumbCache = new Map<string, Promise<{ mime: string; base64: string }>>()
  const thumbOf = (t: GalleryThumb) => {
    let p = thumbCache.get(t.id)
    if (!p) {
      p = downloadThumb(t.url, out.signal)
      p.catch(() => thumbCache.delete(t.id)) // let a later tile retry the download
      thumbCache.set(t.id, p)
    }
    return p
  }

  const fail = (t: Tile, reason: VariantFailure, message: string) => {
    failed++
    emit({ type: 'failed', thumbId: t.thumb.id, index: t.index, reason, message })
  }

  const run = async (t: Tile): Promise<void> => {
    if (out.signal.aborted) return
    const started = Date.now()
    const ok = (src: string) => {
      done++
      emit({ type: 'done', thumbId: t.thumb.id, index: t.index, src, ms: Date.now() - started })
    }
    emit({ type: 'working', thumbId: t.thumb.id, index: t.index })
    try {
      if (mode === 'live') {
        const image = await thumbOf(t.thumb)
        const result =
          provider === 'openrouter'
            ? await generateWithOpenRouter({ baseUrl: env.openrouterBaseUrl, model: OPENROUTER_MODEL, apiKey, prompt: VARIANT_PROMPT, image, signal: out.signal })
            : await generateVariant({ baseUrl: env.baseUrl, model: NANO_BANANA_MODEL, apiKey, prompt: VARIANT_PROMPT, image, signal: out.signal })
        const name = `${t.thumb.id}-${t.index}.${EXT[result.mime]}`
        fs.mkdirSync(env.cacheDir, { recursive: true })
        const tmp = path.join(env.cacheDir, `.${name}.${process.pid}.${Date.now()}.tmp`)
        fs.writeFileSync(tmp, result.bytes)
        // A fresh run replaces any older file of another extension so the output directory has one file per tile.
        for (const ext of ['jpg', 'png', 'webp']) if (ext !== EXT[result.mime]) fs.rmSync(path.join(env.cacheDir, `${t.thumb.id}-${t.index}.${ext}`), { force: true })
        fs.renameSync(tmp, path.join(env.cacheDir, name))
        return ok(imgSrc(env, name))
      }

      fail(t, 'no-key', 'Add a Gemini API key to generate variants for this game.')
    } catch (err) {
      if (out.signal.aborted) return
      if (err instanceof GeminiError) return fail(t, err.reason, err.message)
      console.error('[api] variant failed:', redactKeys((err as Error)?.message ?? String(err), apiKey))
      fail(t, 'upstream', 'Something went wrong on the local server. Retry this tile.')
    }
  }

  // Fixed-size worker pool: never more than CONCURRENCY tiles in flight.
  let next = 0
  const worker = async () => {
    while (!out.signal.aborted) {
      const t = tiles[next++]
      if (!t) return
      await run(t)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tiles.length) }, worker))
  if (!out.signal.aborted) emit({ type: 'end', done, failed })
  out.end()
}

export function serveGeneratedImage(req: IncomingMessage, res: ServerResponse, env: ServerEnv, file: string): void {
  const m = /^[0-9]+-[0-9]+\.(jpg|png|webp)$/.exec(file)
  if (!m) return sendJson(res, 404, { ok: false, code: 'not-found', message: 'No such image.' } satisfies ApiError)
  let data: Buffer
  try {
    data = fs.readFileSync(path.join(env.cacheDir, file))
  } catch {
    return sendJson(res, 404, { ok: false, code: 'not-found', message: 'That variant is not on this server. Generate it again.' } satisfies ApiError)
  }
  res.statusCode = 200
  res.setHeader('content-type', MIME[m[1]])
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  res.setHeader('content-length', data.length)
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(req.method === 'HEAD' ? undefined : data)
}
