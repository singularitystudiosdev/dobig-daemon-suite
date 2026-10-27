import type { DiscordEntry } from '../types'

// Placeholder until the discord tool worker builds the real header.
export function ServerHeader({ entry }: { entry: DiscordEntry }) {
  return <p className="text-label text-muted">{entry.server.name}</p>
}
