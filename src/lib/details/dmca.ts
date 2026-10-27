/* Detail payload for one DMCA Daemon finding: one candidate game that looks like the owner's game, with the real
   evidence behind the match. Both the server analyzer (server/tools/dmca.ts) and the client detail view
   (src/demo/findings/details/dmca.tsx) import it, so it stays JSON-serialisable and runtime-free. */

export type DmcaLane = 'identical' | 'near' | 'review' | 'weak'

export interface DmcaImagePair {
  /** Our image (tr.rbxcdn.com) and theirs. */
  ours: string
  theirs: string
  /** Hamming distance of the two 64-bit difference hashes: 0 is the same picture, about 32 is unrelated. */
  distance: number
  /** True only when the two files have the same sha256. */
  identical: boolean
  /** Histogram intersection of the 4x4x4 colour signatures, 0 to 1. */
  colorSimilarity: number
}

export interface DmcaCandidate {
  universeId: number
  placeId: number
  /** https://www.roblox.com/games/<placeId> */
  url: string
  name: string
  creatorName: string
  creatorId: number
  /** 'User' or 'Group' as Roblox reports it. */
  creatorType: string
  /** https://www.roblox.com/users/<id>/profile or https://www.roblox.com/communities/<id> */
  creatorUrl: string
  playing: number
  visits: number
  /** ISO time, or '' when Roblox did not say. */
  created: string
  descriptionExcerpt: string
}

export interface DmcaDetail {
  kind: 'dmca'
  lane: DmcaLane
  /** Why this candidate is in this lane, in words, with the real numbers. */
  ruleExplanation: string
  /** The three lane rules, as the analyzer applies them. */
  laneRules: Record<DmcaLane, string>
  ours: { universeId: number; placeId: number; name: string; url: string }
  candidate: DmcaCandidate
  /** Closest (our image, their image) pairs: identical first, then by distance; only pairs within the weak threshold, or the single closest. At most 4. */
  imagePairs: DmcaImagePair[]
  /** How many of their images were fetched and compared, and how many of ours they were compared against. */
  imagesCompared: { theirs: number; ours: number; identical: number }
  /** Smallest distance over all pairs; null when none of their images could be compared. */
  bestDistance: number | null
  /** 0 to 1: mean of the name's token Jaccard and Levenshtein ratio. */
  nameSimilarity: number
  /** 0 to 1: Jaccard of 5-word shingles of the two descriptions. */
  descriptionSimilarity: number
  /** Real overlapping phrases between the two descriptions (lower-cased words). */
  sharedPhrases: string[]
  /** One sentence from a language model about what looks reused. Never a verdict. */
  modelNote?: string
  /** A ready-to-complete takedown notice. The owner's identity and statements are bracketed placeholders. */
  notice: string
  /** Creator Hub, Intellectual Property. Roblox Rights Manager has no public API, so filing is a human step. */
  rightsManagerUrl: string
  rightsManagerDocsUrl: string
  /** ISO time of the comparison. */
  checked: string
}
