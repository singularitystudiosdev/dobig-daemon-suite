/* Detail payload for one Creator Dox finding: one way to reach the people behind a game. A finding is either a person
   (the owner, a leader, or an account the owner says is theirs) or one channel (an email, X / Twitter, a Discord server,
   YouTube, a website ...). Everything in it was read from public text the owner or team wrote, from Discord's public
   invite lookup, or from public web search results, during the run. JSON-serialisable; imported by the server analyzer
   (server/tools/creator.ts) and the client view (src/demo/findings/details/creator.tsx). */

export type CreatorChannelKind = 'email' | 'twitter' | 'discord' | 'youtube' | 'twitch' | 'tiktok' | 'instagram' | 'facebook' | 'guilded' | 'linkhub' | 'website' | 'roblox'

/** How sure the tool is that this belongs to the team. */
export type CreatorConfidence = 'Linked by the owner' | 'Verified invite' | 'Found by search'

export type CreatorRelation = 'owner' | 'leader' | 'alt'

export interface CreatorRoleHeld {
  /** The Roblox group the role is in. */
  group: string
  role: string
  rank: number
}

export interface CreatorPerson {
  userId: number
  username: string
  displayName: string
  verified: boolean
  /** https://www.roblox.com/users/<id>/profile */
  profileUrl: string
  relation: CreatorRelation
  /** Every role this person holds, one entry each. Empty for the owner account when it holds none. */
  roles: CreatorRoleHeld[]
  /** Why this person is listed, in a sentence. */
  reason: string
}

export interface CreatorProvenance {
  /** Where it was found, in words: "Profile description of misfitsbsthree". */
  where: string
  /** The page it was found on. */
  url: string
  /** What the text said around it, 200 characters at most; null when it came from a structured field. */
  excerpt: string | null
}

export interface CreatorInvite {
  code: string
  /** https://discord.gg/<code> */
  url: string
  /** live: Discord resolved it. expired: Discord says it is gone. unknown: Discord did not answer. */
  state: 'live' | 'expired' | 'unknown'
  guildId: string | null
  name: string | null
  description: string | null
  members: number | null
  online: number | null
  verified: boolean
  partnered: boolean
  community: boolean
  /** The person who made the invite, when Discord returns it. */
  inviter: { id: string; username: string; displayName: string | null } | null
  /** A team member whose Roblox username is the same text as the inviter's Discord username. A name match only. */
  inviterMatch: { userId: number; username: string } | null
  /** ISO time Discord says the invite stops working; null for a permanent one. */
  expiresAt: string | null
  /** Other invite codes that point to the same server. */
  otherCodes: string[]
}

export interface CreatorLinkRow {
  kind: CreatorChannelKind
  label: string
  url: string
  confidence: CreatorConfidence
}

export interface CreatorRoleRow {
  id: number
  name: string
  rank: number
  memberCount: number
  /** True when its members were read as leaders. */
  leader: boolean
  /** Why it was read or skipped, in a sentence. */
  why: string
}

export interface CreatorDetail {
  kind: 'creator'
  /** person: the row is a human. channel: the row is one way to reach them. */
  subject: 'person' | 'channel'
  game: string
  /** ISO time the public pages were read. */
  fetchedAt: string
  /** Set for a channel. */
  channel: { kind: CreatorChannelKind; label: string; handle: string; url: string } | null
  /** Set for a person. */
  person: CreatorPerson | null
  /** Who published or is linked to this channel (the owner, leaders, alternate accounts). Empty for search-only matches. */
  publishedBy: { userId: number; username: string; displayName: string; relation: CreatorRelation; profileUrl: string }[]
  confidence: CreatorConfidence
  /** True when the only evidence is a web search match, which has not been confirmed. */
  unconfirmed: boolean
  /** Every place it was found, each with a link. */
  provenance: CreatorProvenance[]
  invite: CreatorInvite | null
  /** For a person: the channels found for them. */
  channels: CreatorLinkRow[]
  /** Set when the same person and channel had a different link on the last run. */
  changed: { was: string } | null
  /** On the owner row: the group roles the run checked. */
  roles: CreatorRoleRow[] | null
  /** One sentence: why this sits where it does in the list. */
  rankReason: string
  /** The fixed policy line. */
  notCollected: string
}
