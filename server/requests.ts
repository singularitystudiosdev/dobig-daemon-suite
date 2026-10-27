import { randomUUID } from 'node:crypto'
import type { Store } from './store.ts'

/* Requests for new tooling, sent from the "New tool" panel to the forward deployed engineers. They are saved in
   requests.json (mode 0600, it holds contact details), newest first, capped at 200. When REQUESTS_WEBHOOK_URL is set
   (a Slack or Discord incoming webhook) each new request is also posted there, and `delivered` says whether that post
   was accepted. Without a webhook the request is saved and `delivered` stays false: nothing here pretends otherwise. */

export interface ToolRequest {
  id: string
  createdAt: string
  message: string
  game: string | null
  contact: string
  /** True once the webhook accepted the post. */
  delivered: boolean
}

export interface RequestInput {
  message: string
  game: string | null
  contact: string
}

export const MIN_MESSAGE = 12
export const MAX_MESSAGE = 2000
const MAX_STORED = 200
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 10 * 60_000
const WEBHOOK_TIMEOUT_MS = 8_000
const FILE = 'requests.json'

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const ANY_CONTROL = /[\u0000-\u001f\u007f]/

/** Validates what the client sent. Returns the clean input or one plain sentence saying what to fix. */
export function cleanRequest(raw: unknown): { value: RequestInput } | { error: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { message?: unknown; game?: unknown; contact?: unknown }
  if (typeof o.message !== 'string') return { error: 'Describe what the tool should do.' }
  const message = o.message.replace(/\r\n/g, '\n').trim()
  if (message.length < MIN_MESSAGE) return { error: `Add a little more detail: at least ${MIN_MESSAGE} characters about what the tool should do.` }
  if (message.length > MAX_MESSAGE) return { error: `Keep the description under ${MAX_MESSAGE.toLocaleString('en-US')} characters. You can share more once an engineer replies.` }
  if (CONTROL.test(message)) return { error: 'The description contains characters that cannot be saved. Remove them and try again.' }
  if (typeof o.contact !== 'string') return { error: 'Tell us how to reach you: an email, a Discord name or an X handle.' }
  const contact = o.contact.trim()
  if (contact.length < 3) return { error: 'Tell us how to reach you: an email, a Discord name or an X handle.' }
  if (contact.length > 200 || ANY_CONTROL.test(contact)) return { error: 'That contact is too long or has line breaks. Use one email, Discord name or X handle.' }
  let game: string | null = null
  if (typeof o.game === 'string' && o.game.trim()) {
    game = o.game.trim()
    if (game.length > 200 || ANY_CONTROL.test(game)) return { error: 'That game link is too long or has line breaks. Paste one roblox.com/games link.' }
  }
  return { value: { message, game, contact } }
}

export interface Requests {
  /** Newest first. */
  list(): ToolRequest[]
  /** Saves one request and tries the webhook. Throws RequestsError('rate-limited') past 5 in 10 minutes. */
  add(input: RequestInput): Promise<ToolRequest>
}

export class RequestsError extends Error {
  code: 'rate-limited'
  constructor(code: 'rate-limited', message: string) {
    super(message)
    this.name = 'RequestsError'
    this.code = code
  }
}

function isList(v: unknown): v is ToolRequest[] {
  return Array.isArray(v) && v.every((r) => !!r && typeof r === 'object' && typeof (r as ToolRequest).id === 'string' && typeof (r as ToolRequest).message === 'string')
}

/** The text a webhook receives. Both `text` (Slack) and `content` (Discord) carry it. */
export function webhookText(r: ToolRequest): string {
  const lines = ['New tooling request', '', r.message, '', `Reach them at: ${r.contact}`]
  if (r.game) lines.push(`Game: ${r.game}`)
  const text = lines.join('\n')
  return text.length > 1900 ? `${text.slice(0, 1897)}...` : text
}

export function createRequests(opts: { store: Store; webhookUrl?: string; fetchImpl?: typeof fetch; now?: () => number }): Requests {
  const now = opts.now ?? (() => Date.now())
  const doFetch = opts.fetchImpl ?? fetch
  const items = opts.store.load<ToolRequest[]>(FILE, [], isList)
  const recent: number[] = []
  const hook = opts.webhookUrl?.trim() || ''

  const persist = () => {
    void opts.store.save(FILE, items, { mode: 0o600 }).catch((err) => console.error('[requests] could not save:', err instanceof Error ? err.message : String(err)))
  }

  async function post(r: ToolRequest): Promise<boolean> {
    if (!hook) return false
    try {
      const text = webhookText(r)
      const res = await doFetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      })
      return res.ok
    } catch {
      return false
    }
  }

  return {
    list: () => items.map((r) => ({ ...r })),
    async add(input) {
      const t = now()
      while (recent.length && t - recent[0] > RATE_WINDOW_MS) recent.shift()
      if (recent.length >= RATE_LIMIT) throw new RequestsError('rate-limited', `You sent ${RATE_LIMIT} requests in the last 10 minutes. Wait a little, or add the rest to one request.`)
      recent.push(t)
      const record: ToolRequest = { id: randomUUID(), createdAt: new Date(t).toISOString(), message: input.message, game: input.game, contact: input.contact, delivered: false }
      items.unshift(record)
      if (items.length > MAX_STORED) items.length = MAX_STORED
      record.delivered = await post(record)
      persist()
      return { ...record }
    },
  }
}
