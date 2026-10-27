import { RunError } from '../tools/types.ts'

/* A small Discord REST client for the Discord Daemon. It is the only code that holds the bot token: every error it
   raises is scrubbed of the token first, and the token is never put in a URL. The base URL comes from
   DISCORD_API_BASE (default the real API) so tests can point it at server/test/mock-discord.mjs. */

export const DEFAULT_DISCORD_API = 'https://discord.com/api/v10'
export const DEFAULT_DISCORD_CDN = 'https://cdn.discordapp.com'

export const apiBase = () => (process.env.DISCORD_API_BASE?.trim() || DEFAULT_DISCORD_API).replace(/\/+$/, '')
export const cdnBase = () => (process.env.DISCORD_CDN_BASE?.trim() || DEFAULT_DISCORD_CDN).replace(/\/+$/, '')

/* Permission bits, checked against https://docs.discord.com/developers/topics/permissions today. */
export const PERM = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_CHANNEL: 1n << 10n,
  MANAGE_MESSAGES: 1n << 13n,
  READ_MESSAGE_HISTORY: 1n << 16n,
} as const
export const STAFF_BITS = PERM.ADMINISTRATOR | PERM.MANAGE_MESSAGES | PERM.KICK_MEMBERS | PERM.BAN_MEMBERS | PERM.MANAGE_GUILD
/** View Channels + Read Message History = 66560. */
export const BOT_PERMISSIONS = String(PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY)

export const DISCORD_EPOCH = 1420070400000n
export function snowflakeTime(id: string): number {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH)
  } catch {
    return 0
  }
}
export const snowflakeCompare = (a: string, b: string): number => {
  try {
    const x = BigInt(a)
    const y = BigInt(b)
    return x < y ? -1 : x > y ? 1 : 0
  } catch {
    return 0
  }
}

export const botInviteUrl = (applicationId: string) => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(applicationId)}&scope=bot&permissions=${BOT_PERMISSIONS}`
export const intentSettingsUrl = (applicationId: string) => `https://discord.com/developers/applications/${encodeURIComponent(applicationId)}/bot`
export const messageUrl = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`

/** Removes a token (and anything token-shaped) from text bound for a client or a log. */
export function scrubToken(text: string, token?: string | null): string {
  let out = text
  if (token) out = out.split(token).join('<token>')
  return out.replace(/[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g, '<token>')
}

export class DiscordHttpError extends Error {
  status: number
  discordCode: number | null
  retryAfter: number | null
  constructor(status: number, message: string, discordCode: number | null = null, retryAfter: number | null = null) {
    super(message)
    this.name = 'DiscordHttpError'
    this.status = status
    this.discordCode = discordCode
    this.retryAfter = retryAfter
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new RunError('aborted', 'The run was cancelled.'))
    const t = setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort() {
      clearTimeout(t)
      reject(new RunError('aborted', 'The run was cancelled.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export interface ClientStats {
  requests: number
  rateLimited: number
  waitedMs: number
}

export interface DiscordClient {
  stats: ClientStats
  /** GET a JSON path. Throws DiscordHttpError for any non-2xx after rate-limit retries. */
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>
}

const MAX_WAIT_MS = 45_000

/** Route key for local rate-limit bookkeeping: major parameters (guild, channel) kept, other ids collapsed. */
function routeKey(path: string): string {
  return path.replace(/\/(members)\/\d+/, '/$1/:id').replace(/\?.*$/, '')
}

export function createDiscordClient(token: string, signal?: AbortSignal, onWait?: (ms: number, why: string) => void): DiscordClient {
  const stats: ClientStats = { requests: 0, rateLimited: 0, waitedMs: 0 }
  /** route key -> epoch ms when requests may resume. */
  const holdUntil = new Map<string, number>()
  let globalHold = 0

  async function wait(ms: number, why: string) {
    if (ms <= 0) return
    if (ms > MAX_WAIT_MS) throw new DiscordHttpError(429, 'Discord asked us to wait too long.', null, ms / 1000)
    stats.waitedMs += ms
    onWait?.(ms, why)
    await sleep(ms, signal)
  }

  return {
    stats,
    async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v))
      const url = `${apiBase()}${path}${qs.size ? `?${qs}` : ''}`
      const key = routeKey(path)
      for (let attempt = 0; attempt < 5; attempt++) {
        if (signal?.aborted) throw new RunError('aborted', 'The run was cancelled.')
        await wait(Math.max(holdUntil.get(key) ?? 0, globalHold) - Date.now(), 'rate limit')
        let res: Response
        try {
          res = await fetch(url, {
            headers: { authorization: `Bot ${token}`, accept: 'application/json', 'user-agent': 'DiscordBot (https://dobig.com, 1.0) daemon' },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
          })
        } catch (err) {
          if (signal?.aborted) throw new RunError('aborted', 'The run was cancelled.')
          if (attempt >= 2) throw new DiscordHttpError(0, scrubToken(`Could not reach Discord: ${err instanceof Error ? err.message : 'network error'}`, token))
          await sleep(500 * (attempt + 1), signal)
          continue
        }
        stats.requests++
        const remaining = res.headers.get('x-ratelimit-remaining')
        const resetAfter = Number(res.headers.get('x-ratelimit-reset-after'))
        if (remaining !== null && Number(remaining) <= 0 && Number.isFinite(resetAfter) && resetAfter > 0) holdUntil.set(key, Date.now() + resetAfter * 1000)
        const text = await res.text()
        let body: unknown = null
        try {
          body = text ? JSON.parse(text) : null
        } catch {
          body = null
        }
        if (res.ok) return body as T
        const obj = (body && typeof body === 'object' ? body : {}) as { message?: string; code?: number; retry_after?: number; global?: boolean }
        if (res.status === 429) {
          stats.rateLimited++
          const retry = typeof obj.retry_after === 'number' ? obj.retry_after : Number(res.headers.get('retry-after')) || 1
          const ms = Math.ceil(retry * 1000) + 50
          if (obj.global) globalHold = Date.now() + ms
          else holdUntil.set(key, Date.now() + ms)
          if (attempt >= 4 || ms > MAX_WAIT_MS) throw new DiscordHttpError(429, 'Discord is rate limiting the bot.', null, retry)
          continue
        }
        if (res.status >= 500 && attempt < 2) {
          await sleep(800 * (attempt + 1), signal)
          continue
        }
        throw new DiscordHttpError(res.status, scrubToken(typeof obj.message === 'string' ? obj.message : `Discord answered ${res.status}.`, token), typeof obj.code === 'number' ? obj.code : null)
      }
      throw new DiscordHttpError(429, 'Discord is rate limiting the bot.')
    },
  }
}

/* ---- the Discord objects this tool reads (only the fields it uses) ---- */

export interface DUser {
  id: string
  username: string
  global_name?: string | null
  bot?: boolean
  system?: boolean
}
export interface DMessage {
  id: string
  channel_id: string
  author: DUser
  content: string
  timestamp: string
  type?: number
  webhook_id?: string
  mentions?: DUser[]
}
export interface DChannel {
  id: string
  type: number
  name?: string
  last_message_id?: string | null
}
export interface DRole {
  id: string
  name?: string
  permissions: string
}
export interface DMember {
  roles: string[]
  joined_at?: string | null
  nick?: string | null
  user?: DUser
}
export interface DGuild {
  id: string
  name: string
  owner_id?: string
}
export type DClient = DiscordClient
