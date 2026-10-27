import type { VariantFailure } from '../src/lib/apiTypes.ts'
import { sleep } from './http.ts'

export class GeminiError extends Error {
  reason: VariantFailure

  constructor(reason: VariantFailure, message: string) {
    super(message)
    this.reason = reason
  }
}

export interface GeminiImage {
  bytes: Buffer
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface GeminiRequest {
  baseUrl: string
  model: string
  apiKey: string
  prompt: string
  image: { mime: string; base64: string }
  signal: AbortSignal
  /** Per-call timeout; Nano Banana takes 15-30 s per image. */
  timeoutMs?: number
}

const MAX_RETRIES_429 = 2
type Route = 'generate' | 'interactions'
/** Remembered once the fallback route proved to be the one that works. */
let preferred: Route = 'generate'

const NO_IMAGE_MSG = 'Nano Banana returned no image for this thumbnail. Retry this tile or try another screenshot.'
const BLOCKED_MSG = 'Google declined to edit this thumbnail (safety filter). Try another screenshot.'

function scrub(text: string, key: string): string {
  return key ? text.split(key).join('[redacted]') : text
}

/** Generates one variant. Throws GeminiError with a plain-language message. */
export async function generateVariant(req: GeminiRequest): Promise<GeminiImage> {
  const order: Route[] = preferred === 'generate' ? ['generate', 'interactions'] : ['interactions', 'generate']
  let lastErr: GeminiError | null = null
  for (const route of order) {
    try {
      const out = await callWithRetries(route, req)
      preferred = route
      return out
    } catch (err) {
      if (err instanceof RouteUnsupported) {
        lastErr = new GeminiError('upstream', 'Google does not serve this model on either image route. Check GEMINI_BASE_URL and the model name.')
        continue
      }
      throw err
    }
  }
  throw lastErr ?? new GeminiError('upstream', 'Google did not answer. Try again in a moment.')
}

class RouteUnsupported extends Error {}

async function callWithRetries(route: Route, req: GeminiRequest): Promise<GeminiImage> {
  let modalities: string[] = ['IMAGE']
  for (let attempt = 0; ; attempt++) {
    const res = await post(route, req, modalities)
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES_429) throw new GeminiError('rate-limited', 'Google is rate limiting image generation. Wait a minute and retry this tile.')
      const wait = retryDelayMs(res.headers.get('retry-after'), res.json, attempt)
      await sleep(wait, req.signal)
      continue
    }
    if (res.status === 400 && route === 'generate' && modalities.length === 1 && /modalit|response_?mime|IMAGE/i.test(errText(res.json))) {
      modalities = ['TEXT', 'IMAGE']
      attempt--
      continue
    }
    if (res.status === 404 || (res.status === 400 && /not supported|unsupported|not found|unknown name|invalid json payload/i.test(errText(res.json)) && !/API_KEY_INVALID/.test(errText(res.json)))) {
      if (res.status === 404 && /models\/.*(not found)/i.test(errText(res.json)) && route === 'interactions') throw new GeminiError('upstream', 'Google could not find the Nano Banana model. Check the model name.')
      throw new RouteUnsupported()
    }
    return interpret(res.status, res.json, req.apiKey)
  }
}

interface Reply {
  status: number
  json: unknown
  headers: Headers
}

async function post(route: Route, req: GeminiRequest, modalities: string[]): Promise<Reply> {
  const url =
    route === 'generate'
      ? `${req.baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`
      : `${req.baseUrl}/v1beta/interactions`
  const body =
    route === 'generate'
      ? {
          contents: [{ parts: [{ text: req.prompt }, { inlineData: { mimeType: req.image.mime, data: req.image.base64 } }] }],
          generationConfig: { responseModalities: modalities, imageConfig: { aspectRatio: '16:9', imageSize: '1K' } },
        }
      : {
          model: req.model,
          input: [
            { type: 'text', text: req.prompt },
            { type: 'image', mime_type: req.image.mime, data: req.image.base64 },
          ],
          response_format: { type: 'image', aspect_ratio: '16:9', image_size: '1K' },
          generation_config: { thinking_level: 'minimal' },
          store: false,
        }
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 100_000)
  const signal = AbortSignal.any([req.signal, timeout])
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify(body),
      signal,
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      /* leave null */
    }
    return { status: res.status, json, headers: res.headers }
  } catch (err) {
    if (req.signal.aborted) throw err
    if (timeout.aborted) throw new GeminiError('timeout', 'Nano Banana took longer than 90 seconds. Retry this tile.')
    throw new GeminiError('upstream', scrub('Could not reach Google. Check your connection and retry this tile.', req.apiKey))
  }
}

function errText(json: unknown): string {
  const e = (json as { error?: { message?: unknown; status?: unknown; details?: unknown } } | null)?.error
  if (!e) return ''
  return `${typeof e.status === 'string' ? e.status : ''} ${typeof e.message === 'string' ? e.message : ''} ${JSON.stringify(e.details ?? '')}`
}

function retryDelayMs(header: string | null, json: unknown, attempt: number): number {
  const secs = Number(header)
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 30) * 1000
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(JSON.stringify(json ?? ''))
  if (m) return Math.min(Number(m[1]), 30) * 1000
  return 2000 * (attempt + 1)
}

function interpret(status: number, json: unknown, key: string): GeminiImage {
  const text = errText(json)
  if (status >= 400) {
    if (/API_KEY_INVALID|API key not valid|API key expired/i.test(text) || status === 401) {
      throw new GeminiError('no-key', 'Google rejected the Gemini API key. Check the key and try again.')
    }
    if (status === 403) throw new GeminiError('no-key', 'Google refused this key for Nano Banana. Check that billing is enabled for the key.')
    if (status === 400 && /safety|blocked|prohibited/i.test(text)) throw new GeminiError('blocked', BLOCKED_MSG)
    if (status >= 500) throw new GeminiError('upstream', 'Google had a server error. Retry this tile in a moment.')
    throw new GeminiError('upstream', scrub(`Google rejected the request (HTTP ${status}). Retry this tile.`, key))
  }
  const image = findImage(json)
  if (image) return image
  const j = (json ?? {}) as {
    promptFeedback?: { blockReason?: string }
    candidates?: { finishReason?: string }[]
  }
  if (j.promptFeedback?.blockReason) throw new GeminiError('blocked', BLOCKED_MSG)
  const finish = j.candidates?.[0]?.finishReason
  if (finish && /SAFETY|PROHIBITED|RECITATION|BLOCKLIST/i.test(finish)) throw new GeminiError('blocked', BLOCKED_MSG)
  throw new GeminiError('no-image', NO_IMAGE_MSG)
}

/** Searches any response shape for a base64 image block. */
function findImage(root: unknown): GeminiImage | null {
  const stack: unknown[] = [root]
  let visited = 0
  while (stack.length && visited++ < 5000) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i])
      continue
    }
    if (!node || typeof node !== 'object') continue
    const o = node as Record<string, unknown>
    const mime = String(o.mimeType ?? o.mime_type ?? '')
    if (typeof o.data === 'string' && o.data.length > 100 && (mime.startsWith('image/') || o.type === 'image')) {
      const bytes = Buffer.from(o.data, 'base64')
      const sniffed = sniff(bytes)
      if (sniffed) return { bytes, mime: sniffed }
    }
    for (const v of Object.values(o).reverse()) if (v && typeof v === 'object') stack.push(v)
  }
  return null
}

export function sniff(b: Buffer): GeminiImage['mime'] | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}
