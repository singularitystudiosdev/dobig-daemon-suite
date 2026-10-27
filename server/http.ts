import type { IncomingMessage, ServerResponse } from 'node:http'

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(text))
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(text)
}

export class BodyError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Reads a JSON body, refusing anything over `maxBytes`. */
export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > maxBytes) throw new BodyError(413, 'Request body is too large.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > maxBytes) throw new BodyError(413, 'Request body is too large.')
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) throw new BodyError(400, 'Send a JSON body.')
  try {
    return JSON.parse(text)
  } catch {
    throw new BodyError(400, 'The request body is not valid JSON.')
  }
}

export interface NdjsonStream {
  write(event: unknown): void
  end(): void
  /** Aborts when the client goes away before we finish. */
  signal: AbortSignal
}

/** Starts an NDJSON response with a 10 s blank-line keepalive. */
export function startNdjson(req: IncomingMessage, res: ServerResponse): NdjsonStream {
  res.statusCode = 200
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('x-accel-buffering', 'no')
  res.flushHeaders()
  const ac = new AbortController()
  let closed = false
  const keepalive = setInterval(() => {
    if (!closed) res.write('\n')
  }, 10_000)
  // `req` 'close' fires once the body is consumed on modern Node, so the response
  // (and its socket) is the reliable signal that the client left early.
  const onGone = () => {
    if (closed) return
    closed = true
    clearInterval(keepalive)
    if (!res.writableFinished) ac.abort()
  }
  res.on('close', onGone)
  req.socket.on('close', onGone)
  return {
    signal: ac.signal,
    write(event) {
      if (!closed && !res.writableEnded) res.write(JSON.stringify(event) + '\n')
    },
    end() {
      clearInterval(keepalive)
      closed = true
      if (!res.writableEnded) res.end()
    },
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Scrubs a known key plus anything shaped like an OpenRouter (sk-or-...) or Google (AIza...) key from text bound for a log or the client. */
export function redactKeys(text: string, key = ''): string {
  const plain = key ? text.split(key).join('[redacted]') : text
  return plain.replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]').replace(/AIza[A-Za-z0-9_-]{20,}/g, '[redacted]')
}
