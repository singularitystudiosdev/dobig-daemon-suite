import { GeminiError, BLOCKED_MSG, NO_IMAGE_MSG, sniff, type GeminiImage, type GeminiRequest } from './gemini.ts'
import { redactKeys, sleep } from './http.ts'

/** Same call shape as the Google client: `baseUrl` is OpenRouter's origin, `model` its slug (google/gemini-nano-banana-2.1). */
export type OpenRouterRequest = GeminiRequest

const MAX_RETRIES_429 = 2
const MEDIA: Record<string, GeminiImage['mime']> = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' }

/** Generates one variant through OpenRouter's image API. Throws GeminiError with a plain-language message. */
export async function generateWithOpenRouter(req: OpenRouterRequest): Promise<GeminiImage> {
  for (let attempt = 0; ; attempt++) {
    const res = await post(req)
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES_429) throw new GeminiError('rate-limited', 'OpenRouter is rate limiting image generation. Wait a minute and retry this tile.')
      await sleep(retryDelayMs(res.headers.get('retry-after'), attempt), req.signal)
      continue
    }
    return interpret(res.status, res.json, req.apiKey)
  }
}

interface Reply {
  status: number
  json: unknown
  headers: Headers
}

async function post(req: OpenRouterRequest): Promise<Reply> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/api/v1/images`
  const body = {
    model: req.model,
    prompt: req.prompt,
    input_references: [{ type: 'image_url', image_url: { url: `data:${req.image.mime};base64,${req.image.base64}` } }],
    aspect_ratio: '16:9',
    resolution: '1K',
  }
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 100_000)
  const signal = AbortSignal.any([req.signal, timeout])
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${req.apiKey}` },
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
    if (timeout.aborted) throw new GeminiError('timeout', 'Nano Banana took longer than 100 seconds. Retry this tile.')
    throw new GeminiError('upstream', 'Could not reach OpenRouter. Check your connection and retry this tile.')
  }
}

function retryDelayMs(header: string | null, attempt: number): number {
  const secs = Number(header)
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs, 30) * 1000
  return 2000 * (attempt + 1)
}

function errMessage(json: unknown): string {
  const e = (json as { error?: { message?: unknown } | string } | null)?.error
  if (typeof e === 'string') return e
  return typeof e?.message === 'string' ? e.message : ''
}

function interpret(status: number, json: unknown, key: string): GeminiImage {
  if (status >= 400) {
    const message = errMessage(json)
    if (status === 401) throw new GeminiError('no-key', 'OpenRouter rejected the API key. Check the key and try again.')
    if (status === 402) throw new GeminiError('upstream', 'Your OpenRouter account is out of credits. Add credits at openrouter.ai/credits.')
    if ((status === 400 || status === 403 || status === 422) && /safety|moderat|blocked|policy|prohibited/i.test(message)) throw new GeminiError('blocked', BLOCKED_MSG)
    if (status >= 500) throw new GeminiError('upstream', 'OpenRouter had a server error. Retry this tile in a moment.')
    const shown = redactKeys(message, key).replace(/\s+/g, ' ').trim().slice(0, 240)
    throw new GeminiError('upstream', shown ? `OpenRouter rejected the request (HTTP ${status}): ${shown}` : `OpenRouter rejected the request (HTTP ${status}). Retry this tile.`)
  }
  const first = (json as { data?: { b64_json?: unknown; media_type?: unknown }[] } | null)?.data?.[0]
  if (typeof first?.b64_json === 'string' && first.b64_json.length > 0) {
    const bytes = Buffer.from(first.b64_json, 'base64')
    // The bytes are the truth; media_type is the fallback for formats the sniffer does not know.
    const mime = sniff(bytes) ?? MEDIA[String(first.media_type ?? '').toLowerCase()]
    if (mime && bytes.length > 0) return { bytes, mime }
  }
  throw new GeminiError('no-image', NO_IMAGE_MSG)
}
