import { ApiFailure } from '@/lib/api'

/* Client calls for the Discord routes (server/tools/discord.ts). The bot token is only ever sent to POST /api/discord/token;
   no response contains it. */

export interface BotStatus {
  tokenSet: boolean
  /** False when Discord rejected the saved token; null when it could not be checked. */
  tokenValid?: boolean | null
  bot: { username: string; id: string } | null
  applicationId: string | null
  inGuild: boolean | null
  inviteUrl: string | null
  intent: 'unknown'
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) } })
  } catch {
    throw new ApiFailure(0, 'offline', 'Could not reach the local server. Check that it is running, then try again.')
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null
  if (!res.ok) throw new ApiFailure(res.status, body?.code ?? 'upstream', body?.message ?? `The server answered ${res.status}.`)
  return body as T
}

export const getBotStatus = (guildId: string, signal?: AbortSignal) => send<BotStatus>(`/api/discord/bot-status?guildId=${encodeURIComponent(guildId)}`, { signal })
export const saveBotToken = (token: string) => send<{ ok: true; bot: { username: string; id: string }; applicationId: string }>('/api/discord/token', { method: 'POST', body: JSON.stringify({ token }) })
export const removeBotToken = () => send<{ ok: true }>('/api/discord/token', { method: 'DELETE' })

export const initials = (name: string) =>
  name
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || name.slice(0, 2).toUpperCase()
