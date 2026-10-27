import { games, type Game } from '@/data/games'
import type { GameInfo } from './apiTypes'

/* Turns a game resolved from a pasted link into the `Game` shape every dataset builder takes,
   so the existing seeded generators (hack, dmca, discord, description, creator dox) work for any game. */

/** "[🎃] Grow a Garden 🌶️" becomes "Grow a Garden". */
export function cleanName(name: string): string {
  const stripped = name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s:'&.!-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped || name.trim()
}

/** The core noun of a game loop, used to flavour mock data: "Steal An Egg" gives "egg". */
const FILLER = new Set(['the', 'and', 'for', 'vs', 'with', 'game', 'games', 'simulator', 'tycoon', 'obby', 'roleplay', 'rivals', 'update', 'new', 'online', 'adopt'])

export function nounFor(shortName: string): string {
  const words = shortName
    .toLowerCase()
    .split(/[\s:&-]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2 && !FILLER.has(w))
  const last = words[words.length - 1] ?? 'pet'
  return last.length > 3 && last.endsWith('s') ? last.slice(0, -1) : last
}

export function gameFromInfo(info: GameInfo): Game {
  // A Do Big portfolio game keeps its hand-authored identity, so its datasets use the polished hero records.
  const known = games.find((g) => g.universeId === info.universeId)
  if (known) {
    return { ...known, playing: info.playing, visits: info.visits, favorites: info.favorites, description: info.description || known.description }
  }
  const shortName = cleanName(info.name)
  return {
    id: `u${info.universeId}`,
    name: info.name,
    shortName,
    noun: nounFor(shortName),
    placeId: info.placeId,
    universeId: info.universeId,
    playing: info.playing,
    visits: info.visits,
    favorites: info.favorites,
    maxPlayers: info.maxPlayers,
    created: info.created.slice(0, 10),
    updated: info.updated.slice(0, 10),
    genre: info.genre,
    subgenre: info.subgenre,
    thumb: info.cover ?? '/brand/icon.png',
    description: info.description,
  }
}
