import type { Target } from '../src/lib/runTypes.ts'
import { resolveGame } from './roblox.ts'

/* Fills the right-hand list entry for a daemon: a real title and a real image from the target's own public page. */

export interface DescribeOptions {
  /** DISCORD_API_BASE, default https://discord.com/api/v10 */
  discordApiBase?: string
  signal?: AbortSignal
}

export interface TargetDescription {
  title: string
  image: string | null
}

const DEFAULT_DISCORD_API = 'https://discord.com/api/v10'

export async function describeTarget(target: Target, options: DescribeOptions = {}): Promise<TargetDescription> {
  const fallback: TargetDescription = { title: target.name, image: null }
  try {
    if (target.kind === 'roblox-game') {
      const res = await resolveGame(String(target.placeId))
      return { title: res.game.name || target.name, image: res.gallery[0]?.url ?? res.game.cover ?? null }
    }
    const base = (options.discordApiBase || DEFAULT_DISCORD_API).replace(/\/+$/, '')
    const signals = [AbortSignal.timeout(8000)]
    if (options.signal) signals.push(options.signal)
    const res = await fetch(`${base}/invites/${encodeURIComponent(target.invite)}?with_counts=true`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.any(signals),
    })
    if (!res.ok) return fallback
    const json = (await res.json()) as { guild?: { id?: unknown; name?: unknown; icon?: unknown } }
    const guild = json.guild ?? {}
    const name = typeof guild.name === 'string' && guild.name ? guild.name : target.name
    const id = typeof guild.id === 'string' && /^\d{1,25}$/.test(guild.id) ? guild.id : target.guildId
    const icon = typeof guild.icon === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(guild.icon) ? guild.icon : null
    return { title: name, image: icon && /^\d{1,25}$/.test(id) ? `https://cdn.discordapp.com/icons/${id}/${icon}.png` : null }
  } catch {
    return fallback
  }
}
