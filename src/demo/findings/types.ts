import type { Tone } from '@/lib/tone'

/* The shared shape every findings adapter produces. Adapters are pure: dataset in, Finding[] out.
   Rendering lives in FindingsList (the row) and Details (the expanded region). */

export interface Chip {
  label: string
  tone: Tone
}

/** A run of text; `struck` marks a span the policy lint flagged. */
export interface Segment {
  text: string
  struck?: boolean
}

export interface Meta {
  label: string
  value: string
}

export interface HackDetail {
  kind: 'hack'
  system: string
  side: 'client' | 'server'
  cls: string
  observed: string
  cause: string
  fix: string
  confidence: string
  trend: string
  firstSeen: string
  sources: { title: string; channel: string; verdict: string; views: number }[]
  moreSources: number
}

export interface DmcaDetail {
  kind: 'dmca'
  lane: 'auto-file' | 'review' | 'cleared'
  assetName?: string
  assetId?: number
  assetKind: string
  hashType: string
  similarity?: number
  evidence: string
  placeId: number
  creator: string
  source: string
  detectedAt: string
  note?: string
}

export interface DiscordDetail {
  kind: 'discord'
  people: number
  messages: number
  rating: number
  sentiment: number
  channel: string
  confidence: string
  confidenceNote?: string
  causes: { date: string; delta: number; confidence: number }[]
  quotes: { author: string; text: string; tone: string }[]
}

export interface DescriptionDetail {
  kind: 'description'
  variant: string
  text: Segment[]
  chars: number
  lint: { title: string; passed: boolean; flags: string }[]
  lift: { lo: number; mid: number; hi: number } | null
  baseline: number
  live: boolean
  blocked: boolean
}

export interface CreatorDetail {
  kind: 'creator'
  handle: string
  sponsorLine: string
  erOrganic: number
  erSponsored: number
  earnings: [number, number]
  email?: string
  cqs: { total: number; influence: number; audience: number; credibility: number; engagement: number }
  talking: string[]
}

export type FindingDetail = HackDetail | DmcaDetail | DiscordDetail | DescriptionDetail | CreatorDetail

export interface Finding {
  id: string
  /** Severity or rank mark on the left. */
  badge: Chip
  title: string
  snippet: Segment[]
  /** Right-aligned values: videos, views, first seen and so on. */
  meta: Meta[]
  spark?: { data: number[]; tone: Tone; label: string }
  /** Status chip; `states` swaps it when the user acts on the row. */
  status: Chip
  states?: Record<string, Chip>
  /** Filter lane, when the tool has one. */
  group?: string
  detail: FindingDetail
}

export interface SummaryItem {
  label: string
  value: string
  tone?: Tone
}

export interface Summary {
  items: SummaryItem[]
  note?: string
}

export interface Notice {
  lead: string
  body: string
}

/** Everything the workspace needs for one tool and one game. */
export interface FindingsModel {
  findings: Finding[]
  sortLabel: string
  /** One live detail line per ToolMeta.thinking step; `p` runs 0 to 1 while the step is active. */
  steps: ((p: number) => string)[]
  summary?: (states: Record<string, string>) => Summary
  notices: Notice[]
  groups?: { id: string; label: string }[]
}

export type StateMap = Record<string, string>
