/* Detail payload for one creator finding (Creator Dox). Everything in it was read from public YouTube pages during
   the run, or computed from those numbers; the one exception is the LLM-written wording (brand names, brand-safety
   flags, talking points), which is validated against the real text it read. JSON-serialisable; imported by both the
   server analyzer (server/tools/creator.ts) and the client view (src/demo/findings/details/creator.tsx). */

export type CreatorTier = 'Strong fit' | 'Good fit' | 'Weak fit' | 'Risky'

export type BrandSafetyCategory =
  | 'gambling-style promotions'
  | 'Robux/free-item giveaways'
  | 'exploit or cheat promotion'
  | 'profanity-heavy'
  | 'adult themes'
  | 'misleading thumbnails/clickbait'

export type FlagConfidence = 'low' | 'medium' | 'high'

export interface CreatorFitComponent {
  label: string
  points: number
  max: number
  /** The real inputs behind the points, in one sentence. */
  basis: string
}

export interface CreatorVideoRef {
  title: string
  url: string
  /** Exact when the watch page was read, otherwise the compact figure the channel page shows. */
  views: number | null
  /** What YouTube shows ("3 days ago") or the exact publish date when the watch page was read. */
  publishedText: string
}

export interface CreatorDetail {
  kind: 'creator'
  /** The clean game name the search used. */
  game: string
  /** ISO time the public pages were read. */
  fetchedAt: string
  channel: {
    id: string
    name: string
    handle: string | null
    /** https://www.youtube.com/channel/<id> */
    url: string
    /** The channel page shows a rounded figure ("524K subscribers"); null when the channel hides it. */
    subscribers: number | null
    /** First 280 characters of the public channel description. */
    description: string
  }
  stats: {
    /** Median / mean views of the most recent uploads read (up to 12). */
    median: number | null
    mean: number | null
    /** median / subscribers, a ratio (0.05 = 5%). */
    viewsPerSub: number | null
    /** Median days between consecutive uploads, from the approximate ages YouTube shows. */
    cadenceDays: number | null
    /** How many uploads the median and mean cover. */
    sampleSize: number
    /** Share of the uploads read that are about the game, 0..1. */
    gameShare: number
    uploadsRead: number
    gameUploads: number
    gameUploads30d: number
    /** How many of the sampleSize views are exact (read from the watch page) rather than the channel page's rounded text. */
    exactViews: number
  }
  sponsorship: {
    /** sponsored / sampled, 0..1; null when nothing could be sampled. */
    share: number | null
    sampled: number
    sponsored: number
    organic: number
    sponsoredMedian: number | null
    organicMedian: number | null
    /** Percent difference of sponsored vs organic median views; null unless 3+ sponsored and 3+ organic samples. */
    deltaPct: number | null
    brands: string[]
    examples: { title: string; url: string; views: number | null; disclosure: string }[]
  }
  brandSafety: {
    /** How many recent titles the check read. */
    checked: number
    flags: { category: BrandSafetyCategory; evidenceTitle: string; url: string; confidence: FlagConfidence }[]
    /** YouTube's own family-safe marker from the player response, when present. */
    familySafe: boolean | null
    /** Why the check did not run, when it did not. */
    unavailable?: string
  }
  contact: {
    /** Only an address the creator wrote in the public channel description. */
    email: string | null
    /** Lines of the public description that mention business, sponsor or contact. */
    lines: string[]
  }
  /** Videos about the game from this channel, newest first. */
  gameVideos: CreatorVideoRef[]
  fit: {
    score: number
    tier: CreatorTier
    components: CreatorFitComponent[]
  }
  talkingPoints: string[]
  /** The fixed policy line. */
  notCollected: string
}
