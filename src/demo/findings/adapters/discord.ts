import type { Game } from '@/data/games'
import { fmtDay, fmtInt, fmtPct } from '@/lib/format'
import type { Tone } from '@/lib/tone'
import { buildDataset, exclusionTotals, quotesFor, trendTone, type DiscordDataset, type TopicCluster, type Trend } from '@/tools/discord-daemon/data'
import type { Finding, FindingsModel } from '../types'
import { plain, ramp } from './shared'

const TREND_ORDER: Record<Trend, number> = { 'getting worse': 0, 'cooling off': 1, stable: 2 }
const TREND_LABEL: Record<Trend, string> = { 'getting worse': 'Getting worse', 'cooling off': 'Cooling off', stable: 'Stable' }

/** Trend getting worse first, then most negative sentiment, then most people. */
export function discordFindings(ds: DiscordDataset): Finding[] {
  const sorted = ds.topics.slice().sort((a, b) => TREND_ORDER[a.trend] - TREND_ORDER[b.trend] || a.sentiment - b.sentiment || b.people - a.people)
  return sorted.map((t: TopicCluster) => {
    const quotes = quotesFor(ds, t.id, 3).filter((q) => q.text)
    const tone = trendTone(t.trend) as Tone
    return {
      id: t.id,
      badge: { label: TREND_LABEL[t.trend], tone },
      title: t.label,
      snippet: plain(quotes[0]?.text ? `"${quotes[0].text}"` : 'Message text is not available: metadata only.'),
      meta: [
        { label: 'People', value: fmtInt(t.people) },
        { label: 'Messages', value: fmtInt(t.messages) },
        { label: 'Est. rating', value: `${t.rating.toFixed(1)} of 5` },
      ],
      status: { label: t.category, tone: 'muted' },
      detail: {
        kind: 'discord',
        people: t.people,
        messages: t.messages,
        rating: t.rating,
        sentiment: t.sentiment,
        channel: t.channel,
        confidence: t.confidence,
        confidenceNote: t.confidenceNote,
        causes: ds.mood.drops.flatMap((d) => d.causes.filter((c) => c.topicId === t.id).map((c) => ({ date: fmtDay(d.date), delta: d.delta, confidence: c.confidence }))),
        quotes: quotes.map((q) => ({ author: q.author, text: q.text ?? '', tone: q.tone })),
      },
    } satisfies Finding
  })
}

export function discordModel(game: Game): FindingsModel {
  const ds = buildDataset(game)
  const findings = discordFindings(ds)
  const w = ds.window
  const excluded = exclusionTotals(ds.exclusions)
  const k = ds.topics.length
  return {
    findings,
    sortLabel: 'Sorted by urgency',
    steps: [
      () => `${ds.server.name}, ${fmtInt(ds.server.members)} members, ${ds.channels.length} channels readable`,
      (p) => `${fmtInt(ramp(w.messages, p))} of ${fmtInt(w.messages)} messages read`,
      (p) => `${fmtInt(ramp(w.people, p))} people counted, ${fmtInt(ramp(excluded.accounts, p))} accounts set aside`,
      (p) => `${Math.max(1, Math.ceil(k * p))} of ${k} topics clustered`,
      (p) => `${ramp(k, p)} of ${k} topics ranked by trend, sentiment and people`,
    ],
    summary: () => ({
      items: [
        { label: 'People counted', value: fmtInt(w.people) },
        { label: 'Messages read', value: fmtInt(w.messages) },
        { label: 'Negative share of people', value: fmtPct(w.negativePeopleShare, 0), tone: w.negativePeopleShare > w.previousNegativePeopleShare ? 'danger' : 'warn' },
        { label: 'Excluded: staff, raids, bots', value: fmtInt(excluded.accounts) },
      ],
      note: `Sentiment counts each person once, not each message. Ratings are estimated from message tone. Quotes are short and fictional.`,
    }),
    notices: [],
  }
}
