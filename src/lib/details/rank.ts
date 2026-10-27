/* Detail payload for one rank finding (one search phrase and where the game stood for it).
   Imported by the analyzer (server/tools/rank.ts) and the client view (src/demo/findings/details/rank.tsx), so this
   file has no imports and stays JSON-serialisable. */

/** How the position moved since the previous run of the same phrase.
 *  first: no earlier read of this phrase. climbed/dropped/steady: found both times. new: found now, not found last run.
 *  lost: found last run, not in the first 100 now. absent: not found now and not found before. */
export type RankStatus = 'first' | 'climbed' | 'dropped' | 'steady' | 'new' | 'lost' | 'absent'

/** Where a search phrase came from; the view prints the label. */
export type RankPhraseSource = 'name' | 'name-variant' | 'genre' | 'description' | 'model'

export const PHRASE_SOURCE_LABEL: Record<RankPhraseSource, string> = {
  name: 'The game name',
  'name-variant': 'The game name without symbols or brackets',
  genre: 'The genre Roblox lists for the game',
  description: 'A word the game description uses most',
  model: 'Suggested by the AI model',
}

/** How many games deep a phrase is read. A position is only ever 1 to this number, or null. */
export const RANK_DEPTH = 100

export interface RankNeighbor {
  placeId: number
  universeId: number
  name: string
  /** https://www.roblox.com/games/<placeId> */
  url: string
  playing: number
  /** up / (up + down) votes, or null when nobody voted. */
  likeRatio: number | null
  /** Roblox marks it as an ad. Ads are shown but never counted as a position. */
  sponsored: boolean
  /** 1-based organic position in this search, or null for an ad. */
  position: number | null
}

export interface RankPasser {
  placeId: number
  name: string
  url: string
  playing: number
  /** Where it stood last run (organic, 1-based) and where it stands now. */
  was: number
  now: number
}

export interface RankHistoryPoint {
  /** ISO time of the run. */
  at: string
  /** Position in that run, or null when the game was not in the first 100. */
  position: number | null
}

export interface RankDetail {
  kind: 'rank'
  /** The phrase exactly as it was typed into Roblox search. */
  phrase: string
  source: RankPhraseSource
  status: RankStatus
  /** The game's own name as read this run. */
  gameName: string
  /** 1-based organic position now, or null when not in the first 100. */
  position: number | null
  /** Position in the previous run of this phrase, or null when it was not found then. */
  previous: number | null
  /** There is an earlier read of this phrase at all. */
  hadPrevious: boolean
  /** Earlier reads found the game at least once (so a return is "back", not a first). */
  everFound: boolean
  /** previous - position when both exist: positive means climbed. */
  change: number | null
  /** The ten organic games around the game (five above, five below), ads shown where they sat. When the game is not
   *  found this is the top of the results instead (see aroundKind). */
  around: RankNeighbor[]
  aroundKind: 'around' | 'top'
  /** Games that were below the game last run and are above it now. */
  passed: RankPasser[]
  /** Whether the earlier order is known, so an empty `passed` means nobody passed and not "unknown". */
  passedKnown: boolean
  /** Up to the last 10 reads, oldest first, ending with this one. */
  history: RankHistoryPoint[]
  /** How many organic results were read this run, and how many ads were set aside. */
  scanned: number
  adsSeen: number
  pages: number
  /** ISO time the search ran. */
  fetchedAt: string
  /** The same search on roblox.com. */
  searchUrl: string
}
