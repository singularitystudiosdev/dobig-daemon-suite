/* Detail payload for one sentiment finding (a topic the community talks about). Counted per PERSON: `people` and
   `shares` are numbers of people, never of messages. Both the server analyzer (server/tools/discord.ts) and the
   client detail view (src/demo/findings/details/sentiment.tsx) import it; it stays JSON-serialisable. */

/** One message's (or one person's) stance. */
export type Sentiment = 'negative' | 'mixed' | 'neutral' | 'positive'

/** A topic's overall sentiment, the five badges of the list. */
export type TopicSentiment = 'strongly-negative' | 'negative' | 'mixed' | 'neutral' | 'positive'

export interface SentimentQuote {
  /** The author's displayed name in the server. Shown with the quote only, never as a profile. */
  author: string
  /** At most 140 characters, never an @mention of a user id. */
  text: string
  sentiment: Sentiment
  /** https://discord.com/channels/<guild>/<channel>/<message> */
  url: string
  /** ISO time the message was sent. */
  at: string
}

export interface SentimentDetail {
  kind: 'sentiment'
  topic: string
  sentiment: TopicSentiment
  /** -1 (everyone strongly negative) to +1 (everyone strongly positive): the mean of each person's own polarity. */
  score: number
  /** People who talked about this topic, each counted once. */
  people: number
  /** Messages about this topic from those people. */
  messages: number
  /** People per stance (each person's majority stance on this topic, weighted by intensity). */
  shares: { negative: number; mixed: number; neutral: number; positive: number }
  /** Where people talked about it: people per channel, most first. */
  channels: { name: string; people: number }[]
  quotes: SentimentQuote[]
  /** Compared with the previous run of this daemon, or null on the first run or a new topic. */
  trend: { previousScore: number; delta: number } | null
  /** Why to read this one with care (a small group, many sarcastic or emoji-only messages). */
  confidenceNote?: string
}
