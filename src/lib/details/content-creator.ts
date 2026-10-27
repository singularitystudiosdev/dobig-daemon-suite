/* Detail payload for one Content Creator Daemon finding: one YouTube creator, why they fit, the drafted outreach
   message and where the creator sits in the owner's pipeline. Everything here was read from public YouTube pages
   during the run or computed from those numbers; the LLM only wrote the subject and two sentences of the draft, and
   those are checked against the real text. Imported by the analyzer (server/tools/content-creator.ts) and the client view
   (src/demo/findings/details/content-creator.tsx), so this file has no imports and stays JSON-serialisable. */

export type ContentCreatorTier = 'Strong fit' | 'Good fit' | 'Weak fit' | 'Risky'

/** What the list chip says. New, Drafted and Ready come from the run; Contacted and Replied are the owner's marks. */
export type ContentCreatorStatus = 'New' | 'Drafted' | 'Ready' | 'Contacted' | 'Replied' | 'Not drafted'

/** The owner's mark for one creator, kept by the server between runs. */
export type ContentCreatorMark = 'new' | 'contacted' | 'replied'

export type ContentCreatorSafetyCategory =
  | 'gambling-style promotions'
  | 'Robux/free-item giveaways'
  | 'exploit or cheat promotion'
  | 'profanity-heavy'
  | 'adult themes'
  | 'misleading thumbnails/clickbait'

export interface ContentCreatorFitComponent {
  key: 'game' | 'genre' | 'reach' | 'sponsorship' | 'safety'
  label: string
  points: number
  max: number
  /** The real inputs behind the points, in one plain sentence. */
  line: string
}

export interface ContentCreatorVideoRef {
  title: string
  /** https://www.youtube.com/watch?v=<id>, an id read from a fetched page. */
  url: string
  views: number | null
  /** What YouTube shows ("3 days ago"). */
  publishedText: string | null
  /** Why this video was picked: it is about the game, about similar games, or simply the latest upload. */
  about: 'game' | 'similar' | 'latest'
}

export interface ContentCreatorDraft {
  subject: string
  body: string
  /** Every bracketed placeholder the owner fills in, in order of appearance. */
  placeholders: string[]
}

export interface ContentCreatorDetail {
  kind: 'content-creator'
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
    /** The channel's About page, for finding a contact when no email is published. */
    aboutUrl: string
    /** The channel page shows a rounded figure ("524K subscribers"); null when the channel hides it. */
    subscribers: number | null
  }
  stats: {
    /** Median views of the most recent uploads read (up to 12). */
    median: number | null
    /** median / subscribers, a ratio (0.05 = 5%). */
    viewsPerSub: number | null
    uploadsRead: number
    gameUploads: number
    similarUploads: number
    gameUploads30d: number
  }
  fit: {
    /** 0 to 100. */
    score: number
    tier: ContentCreatorTier
    components: ContentCreatorFitComponent[]
  }
  sponsorship: {
    sampled: number
    sponsored: number
    /** Up to 2 sponsored videos with the creator's own disclosure words. */
    examples: { title: string; url: string; disclosure: string }[]
  }
  safety: {
    /** How many recent titles the check read. */
    checked: number
    flags: { category: ContentCreatorSafetyCategory; evidenceTitle: string; url: string; confidence: 'low' | 'medium' | 'high' }[]
    /** Why the check did not run, when it did not. */
    unavailable?: string
  }
  contact: {
    /** Only an address written verbatim in the creator's public text. */
    email: string | null
    /** Where the address was found, in words ("the channel About text"). Null when none was found. */
    source: string | null
    /** The line of public text that holds the address. */
    excerpt: string | null
  }
  /** The real video the draft refers to. */
  video: ContentCreatorVideoRef | null
  /** Null for creators who are not a good match (weak or risky): no message is written for them. */
  draft: ContentCreatorDraft | null
  /** The chip the run put on this creator. The owner's marks are applied on top of it by the view. */
  status: ContentCreatorStatus
  /** ISO time the creator was first seen by this daemon. */
  firstSeen: string
  /** What moved a lot since the last run ("Median views are up 42%"), or null. */
  changed: string | null
  /** The fixed policy line. */
  notCollected: string
}
