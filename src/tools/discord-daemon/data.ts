import { createRng, type Rng } from '@/lib/random'
import { clamp } from '@/lib/format'
import type { Game } from '@/data/games'

/* Discord Daemon datasets. Steal An Egg is hand-authored from the product spec; every other
   game derives its own coherent record from the game's noun and short name with a seeded RNG,
   so the same game always reads the same and every number stays plausible for its size. */

export type Category = 'Issues & Bugs' | 'User Feedback' | 'General Questions' | 'Marketing Ideas'
export type Trend = 'stable' | 'cooling off' | 'getting worse'
export type Confidence = 'high' | 'medium' | 'low'
export type ExclusionKind = 'staff' | 'raid' | 'bot'
export type MessageTone = 'negative' | 'positive' | 'neutral' | 'mixed'
export type Severity = 'info' | 'ok' | 'warn' | 'danger'

export interface ServerConn {
  guildId: string
  name: string
  members: number
  intents: { guildMessages: boolean; messageContent: 'approved' | 'pending' | 'denied'; readHistory: boolean }
}

export interface TopicCluster {
  id: string
  label: string
  category: Category
  people: number
  messages: number
  sentiment: number
  rating: number
  trend: Trend
  sampleMessageIds: string[]
  channel: string
  confidence: Confidence
  confidenceNote?: string
}

export interface MoodDrop {
  date: string
  delta: number
  causes: { topicId: string; confidence: number }[]
}

export interface Exclusion {
  kind: ExclusionKind
  accounts: number
  messages: number
  window?: string
}

export interface MessageQuote {
  id: string
  topicId: string
  author: string
  /** null when MESSAGE_CONTENT is not approved: metadata arrives, content does not. */
  text: string | null
  channel: string
  at: string
  tone: MessageTone
}

export interface Insight {
  id: string
  title: string
  detail: string
  severity: Severity
  trend: Trend
  topicId: string | null
  messageCount: number
  channel: string
}

export interface DramaCheck {
  id: string
  topicId: string
  topicLabel: string
  last3hPeople: number
  lastWeekPeople: number
  last3hNegative: number | null
  lastWeekNegative: number | null
  verdict: 'alert' | 'watch' | 'clear'
  note: string
}

export interface ReleaseReport {
  label: string
  shippedOn: string
  day: number
  summary: string
  verdict: string
  shipped: string[]
  resolved: string[]
  open: string[]
  series: { day: string; sentiment: number | null; messages: number }[]
}

export interface CrowdPerson {
  index: number
  kind: 'member' | 'staff' | 'raid' | 'bot'
  messages: number
  topicIndex: number
  heavy: boolean
}

export interface Crowd {
  people: CrowdPerson[]
  accounts: number
  counted: number
  totalMessages: number
  heavyIndex: number
}

export interface DiscordDataset {
  gameId: string
  server: ServerConn
  metadataOnly: boolean
  channels: { id: string; name: string; messages: number }[]
  window: {
    start: string
    end: string
    hours: number
    messages: number
    accounts: number
    people: number
    negativeMessageShare: number
    negativePeopleShare: number
    previousNegativePeopleShare: number
  }
  topics: TopicCluster[]
  mood: { series: { date: string; sentiment: number }[]; drops: MoodDrop[] }
  exclusions: Exclusion[]
  quotes: MessageQuote[]
  insights: Insight[]
  drama: { nextCheckAt: string; lastCheckAt: string; baseline: string; checks: DramaCheck[] }
  release: ReleaseReport
  heavyPoster: { handle: string; messages: number }
  crowd: Crowd
}

export const CATEGORIES: Category[] = ['Issues & Bugs', 'User Feedback', 'General Questions', 'Marketing Ideas']
export const EXCLUSION_LABEL: Record<ExclusionKind, string> = {
  staff: 'Staff',
  raid: 'Raid cluster',
  bot: 'Bots and webhooks',
}

export function serverFor(game: Game, members: number, seed: string): ServerConn {
  const rng = createRng(seed + '-server')
  return {
    guildId: String(rng.int(100000000000000000, 999999999999999999)),
    name: `${game.shortName} Community`,
    members,
    intents: { guildMessages: true, messageContent: 'approved', readHistory: true },
  }
}

/** Integer split of `total` across `weights`, summing exactly to total. */
function splitTotal(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0) || 1
  const raw = weights.map((w) => (total * w) / sum)
  const out = raw.map((v) => Math.floor(v))
  let rest = total - out.reduce((a, v) => a + v, 0)
  let i = 0
  while (rest > 0 && out.length > 0) {
    out[i % out.length] += 1
    rest -= 1
    i += 1
  }
  return out
}

const HERO_TOPICS: TopicCluster[] = [
  {
    id: 'golden-egg-dupe',
    label: 'Golden egg dupe',
    category: 'Issues & Bugs',
    people: 148,
    messages: 1033,
    sentiment: -0.62,
    rating: 1.8,
    trend: 'getting worse',
    sampleMessageIds: [],
    channel: '#bugs',
    confidence: 'high',
  },
  {
    id: 'nest-decorations',
    label: 'Nest decorations update',
    category: 'User Feedback',
    people: 203,
    messages: 612,
    sentiment: 0.48,
    rating: 4.4,
    trend: 'stable',
    sampleMessageIds: [],
    channel: '#general',
    confidence: 'high',
  },
  {
    id: 'trade-scams',
    label: 'Trade scams in #trading',
    category: 'Issues & Bugs',
    people: 77,
    messages: 401,
    sentiment: -0.41,
    rating: 2.6,
    trend: 'cooling off',
    sampleMessageIds: [],
    channel: '#trading',
    confidence: 'high',
  },
  {
    id: 'hatch-timers',
    label: 'Hatch timer questions',
    category: 'General Questions',
    people: 96,
    messages: 344,
    sentiment: 0.05,
    rating: 3.2,
    trend: 'stable',
    sampleMessageIds: [],
    channel: '#help',
    confidence: 'medium',
  },
  {
    id: 'season-two',
    label: 'Season 2 teaser ideas',
    category: 'Marketing Ideas',
    people: 54,
    messages: 188,
    sentiment: 0.36,
    rating: 4.1,
    trend: 'stable',
    sampleMessageIds: [],
    channel: '#suggestions',
    confidence: 'medium',
  },
  {
    id: 'mobile-lag',
    label: 'Server lag in busy lobbies',
    category: 'Issues & Bugs',
    people: 63,
    messages: 271,
    sentiment: -0.18,
    rating: 2.9,
    trend: 'cooling off',
    sampleMessageIds: [],
    channel: '#bugs',
    confidence: 'low',
    confidenceNote: 'Sarcasm and meme replies dominate, so this sentiment is low confidence.',
  },
]

function topicTemplates(game: Game): { label: string; category: Category; channel: string }[] {
  const Noun = game.noun[0].toUpperCase() + game.noun.slice(1)
  return [
    { label: `Duplicate ${game.noun} rewards`, category: 'Issues & Bugs', channel: '#bugs' },
    { label: `${Noun} cosmetics update`, category: 'User Feedback', channel: '#general' },
    { label: 'Trade scams in #trading', category: 'Issues & Bugs', channel: '#trading' },
    { label: `${Noun} progression questions`, category: 'General Questions', channel: '#help' },
    { label: 'Season 2 teaser ideas', category: 'Marketing Ideas', channel: '#suggestions' },
    { label: 'Server lag in busy lobbies', category: 'Issues & Bugs', channel: '#bugs' },
  ]
}

function heroDataset(): {
  members: number
  messages: number
  accounts: number
  people: number
  negativeMessageShare: number
  negativePeopleShare: number
  heavyHandle: string
  heavyMessages: number
  topics: TopicCluster[]
  exclusions: Exclusion[]
  drops: MoodDrop[]
} {
  return {
    members: 214000,
    messages: 4212,
    accounts: 706,
    people: 611,
    negativeMessageShare: 0.38,
    negativePeopleShare: 0.14,
    heavyHandle: 'eggdupe_king',
    heavyMessages: 312,
    topics: HERO_TOPICS.map((t) => ({ ...t, label: t.label })),
    exclusions: [
      { kind: 'raid', accounts: 82, messages: 1190, window: '02:14 to 02:31' },
      { kind: 'bot', accounts: 4, messages: 742 },
      { kind: 'staff', accounts: 9, messages: 386 },
    ],
    drops: [
      { date: '2026-10-23', delta: -0.21, causes: [{ topicId: 'golden-egg-dupe', confidence: 64 }, { topicId: 'mobile-lag', confidence: 22 }, { topicId: 'trade-scams', confidence: 9 }] },
      { date: '2026-10-20', delta: -0.09, causes: [{ topicId: 'trade-scams', confidence: 44 }, { topicId: 'mobile-lag', confidence: 21 }, { topicId: 'season-two', confidence: 8 }] },
      { date: '2026-10-22', delta: -0.07, causes: [{ topicId: 'mobile-lag', confidence: 38 }, { topicId: 'hatch-timers', confidence: 19 }, { topicId: 'trade-scams', confidence: 12 }] },
    ],
  }
}

function derivedDataset(game: Game, rng: Rng) {
  const members = Math.round(game.playing * rng.float(0.18, 0.27)) + 1200
  const messages = Math.max(360, Math.round(members * rng.float(0.02, 0.042)))
  const raidAccounts = Math.max(3, Math.round(members * rng.float(0.0002, 0.0008)))
  const staffAccounts = Math.max(3, Math.round(members * rng.float(0.00004, 0.00018)))
  const botAccounts = rng.int(3, 6)
  const exclusions: Exclusion[] = [
    { kind: 'raid', accounts: raidAccounts, messages: Math.min(Math.round(messages * rng.float(0.14, 0.22)), raidAccounts * 16), window: `0${rng.int(1, 4)}:${String(rng.int(10, 55)).padStart(2, '0')} to 0${rng.int(2, 5)}:${String(rng.int(10, 55)).padStart(2, '0')}` },
    { kind: 'bot', accounts: botAccounts, messages: Math.min(Math.round(messages * rng.float(0.07, 0.12)), botAccounts * 40) },
    { kind: 'staff', accounts: staffAccounts, messages: Math.min(Math.round(messages * rng.float(0.03, 0.06)), staffAccounts * 30) },
  ]
  const excludedAccounts = exclusions.reduce((a, e) => a + e.accounts, 0)
  const accounts = Math.max(excludedAccounts + rng.int(14, 42), Math.round(messages * rng.float(0.15, 0.21)))
  const people = Math.max(8, accounts - excludedAccounts)
  const negativePeopleShare = rng.float(0.07, 0.29)
  const templates = topicTemplates(game)
  const weights = [rng.float(0.2, 0.3), rng.float(0.11, 0.2), rng.float(0.07, 0.13), rng.float(0.06, 0.11), rng.float(0.03, 0.07), rng.float(0.04, 0.08)]
  const topicMessages = splitTotal(Math.round(messages * 0.68), weights).map((m) => Math.max(8, m))
  const sentiments = [-0.68, 0.52, -0.44, 0.06, 0.4, -0.22].map((s) => clamp(s + rng.float(-0.09, 0.09), -0.9, 0.9))
  const peopleWeights = topicMessages.map((m, i) => m * rng.float(0.5, 1.5) * (1 + Math.abs(sentiments[i])))
  const topicPeople = splitTotal(Math.max(6, Math.round(people * rng.float(0.72, 0.9))), peopleWeights)
  const topics: TopicCluster[] = templates.map((t, i) => {
    const sentiment = sentiments[i]
    const trend: Trend = sentiment > 0.1 ? 'stable' : rng.chance(0.45) ? 'getting worse' : 'cooling off'
    const confidence: Confidence = i === 5 ? 'low' : rng.chance(0.75) ? 'high' : 'medium'
    return {
      id: `topic-${i + 1}`,
      label: t.label,
      category: t.category,
      people: Math.max(2, topicPeople[i]),
      messages: topicMessages[i],
      sentiment,
      rating: Math.round(clamp(3.2 + sentiment * 2.2, 1, 5) * 10) / 10,
      trend: sentiment > 0.1 ? 'stable' : trend,
      sampleMessageIds: [],
      channel: t.channel,
      confidence,
      confidenceNote: confidence === 'low' ? 'Sarcasm and meme replies dominate, so sentiment is low confidence.' : undefined,
    }
  })
  const dupe = topics[0]
  const lag = topics[5]
  const scams = topics[2]
  const help = topics[3]
  const drops: MoodDrop[] = [
    { date: '2026-10-23', delta: -0.21, causes: [{ topicId: dupe.id, confidence: 61 }, { topicId: lag.id, confidence: 23 }, { topicId: scams.id, confidence: 8 }] },
    { date: '2026-10-20', delta: -0.09, causes: [{ topicId: scams.id, confidence: 44 }, { topicId: lag.id, confidence: 21 }, { topicId: help.id, confidence: 9 }] },
    { date: '2026-10-22', delta: -0.07, causes: [{ topicId: lag.id, confidence: 38 }, { topicId: help.id, confidence: 19 }, { topicId: scams.id, confidence: 12 }] },
  ]
  return {
    members,
    messages,
    accounts,
    people,
    negativeMessageShare: clamp(negativePeopleShare + rng.float(0.14, 0.28), 0.16, 0.58),
    negativePeopleShare,
    heavyHandle: `${game.noun}_storm`,
    heavyMessages: Math.max(4, Math.round(messages * rng.float(0.06, 0.09))),
    topics,
    exclusions,
    drops,
  }
}

const QUOTE_LINES: Record<Category, { tone: MessageTone; lines: string[] }[]> = {
  'Issues & Bugs': [
    {
      tone: 'negative',
      lines: [
        'the {noun} dupe is still eating my rewards',
        'lost three {noun}s to the same glitch this morning',
        'third time today my {noun} vanished mid trade',
        'please fix the {noun} dupe before the weekend',
        'is the {noun} fix shipping with the next patch or not',
      ],
    },
    { tone: 'neutral', lines: ['anyone else seeing their {noun} disappear?', 'is this a known issue or just me'] },
  ],
  'User Feedback': [
    {
      tone: 'positive',
      lines: [
        'the new {noun} colours are genuinely great',
        'this update is the best one this year',
        'the {noun} redesign looks so much cleaner',
        'small thing but the new sounds are perfect',
      ],
    },
    { tone: 'mixed', lines: ['love the {noun} look, not sure about the price', 'nice update, the timer still feels long'] },
  ],
  'General Questions': [
    { tone: 'neutral', lines: ['how long is the {noun} timer after the update?', 'what is the fastest way to get a rare {noun}?', 'does the {noun} reset on Sunday or Monday'] },
  ],
  'Marketing Ideas': [
    { tone: 'positive', lines: ['season 2 teaser should show the golden {noun}', 'put the rarest {noun} on the thumbnail', 'a limited {noun} event would pop off'] },
  ],
}

const HANDLE_A = ['mossy', 'turbo', 'sunny', 'quiet', 'peppy', 'frosty', 'lucky', 'noodle', 'pixel', 'rapid', 'sleepy', 'zippy', 'cozy', 'brisk', 'mellow']
const HANDLE_B = ['otter', 'comet', 'ember', 'pebble', 'cider', 'willow', 'harbor', 'pilot', 'cobalt', 'maple', 'ranger', 'sprout']

function handleFor(rng: Rng, game: Game): string {
  return `${rng.pick(HANDLE_A)}_${rng.pick(HANDLE_B)}${rng.chance(0.4) ? rng.int(2, 99) : ''}`
}

function fillQuote(line: string, game: Game): string {
  return line.replace(/\{noun\}/g, game.noun)
}

function buildQuotes(game: Game, topics: TopicCluster[], rng: Rng, metadataOnly: boolean): MessageQuote[] {
  const out: MessageQuote[] = []
  let n = 0
  for (const topic of topics) {
    const groups = QUOTE_LINES[topic.category]
    const pool = groups.flatMap((g) => g.lines.map((line) => ({ line, tone: g.tone })))
    const count = 4
    for (let i = 0; i < count; i++) {
      const pick = pool[(i + n) % pool.length]
      n += 1
      out.push({
        id: `msg-${out.length + 1}`,
        topicId: topic.id,
        author: handleFor(rng, game),
        text: metadataOnly ? null : fillQuote(pick.line, game),
        channel: topic.channel,
        at: new Date(Date.UTC(2026, 9, 26, rng.int(7, 22), rng.int(0, 59))).toISOString(),
        tone: pick.tone,
      })
    }
    topic.sampleMessageIds = out.slice(-count).map((q) => q.id)
  }
  return out
}

function buildInsights(topics: TopicCluster[], exclusions: Exclusion[], metadataOnly: boolean, game: Game): Insight[] {
  const [dupe, cosmetics, scams, help, season, lag] = topics
  const raid = exclusions.find((e) => e.kind === 'raid')
  if (metadataOnly) {
    return [
      { id: 'ins-volume', title: `Posting volume ${dupe.trend === 'getting worse' ? 'is climbing' : 'held steady'} in ${dupe.channel}`, detail: 'Counted from message metadata only. Author, channel and timestamp arrive; content does not.', severity: 'info', trend: dupe.trend, topicId: dupe.id, messageCount: Math.min(24, dupe.messages), channel: dupe.channel },
      { id: 'ins-reach', title: `${help.people} people posted in ${help.channel}`, detail: 'Questions and answers cannot be told apart without message content.', severity: 'info', trend: 'stable', topicId: help.id, messageCount: Math.min(16, help.messages), channel: help.channel },
      { id: 'ins-cosmetics', title: `${cosmetics.channel} has the most first-time posters`, detail: 'New authors are counted by distinct id, so raids and bots inflate the raw number until they are excluded.', severity: 'ok', trend: cosmetics.trend, topicId: cosmetics.id, messageCount: Math.min(18, cosmetics.messages), channel: cosmetics.channel },
      { id: 'ins-scams', title: `${scams.people} people posted in ${scams.channel}`, detail: 'Trade volume is stable week over week, but scam reports need content to confirm.', severity: 'warn', trend: scams.trend, topicId: scams.id, messageCount: Math.min(24, scams.messages), channel: scams.channel },
      { id: 'ins-raid', title: `${raid?.accounts ?? 0} accounts joined and posted inside 17 minutes`, detail: `The raid cluster was excluded by join time and posting burst, which metadata still exposes (${raid?.messages ?? 0} messages dropped).`, severity: 'warn', trend: 'stable', topicId: cosmetics.id, messageCount: 24, channel: '#general' },
      { id: 'ins-release', title: `Day 7 of the ${game.shortName} update is volume-neutral`, detail: 'A content-based read needs MESSAGE_CONTENT approved on the bot application.', severity: 'info', trend: 'stable', topicId: season.id, messageCount: Math.min(12, season.messages), channel: season.channel },
    ]
  }
  return [
    { id: 'ins-dupe', title: `${dupe.label} is the loudest complaint`, detail: `${dupe.people} people reported missing rewards in ${dupe.channel}. Reports are up on the Oct 23 dip and still climbing.`, severity: 'danger', trend: dupe.trend, topicId: dupe.id, messageCount: Math.min(24, dupe.messages), channel: dupe.channel },
    { id: 'ins-cosmetics', title: `${cosmetics.label} landed well`, detail: `Sentiment is ${cosmetics.sentiment > 0 ? '+' : ''}${cosmetics.sentiment.toFixed(2)} across ${cosmetics.people} people, and it holds through the weekend.`, severity: 'ok', trend: cosmetics.trend, topicId: cosmetics.id, messageCount: Math.min(18, cosmetics.messages), channel: cosmetics.channel },
    { id: 'ins-scams', title: 'Trade scam reports are cooling off', detail: 'Reports peaked Oct 24 and have fallen for two days since the trade confirmation screen shipped.', severity: 'warn', trend: scams.trend, topicId: scams.id, messageCount: Math.min(31, scams.messages), channel: scams.channel },
    { id: 'ins-lag', title: 'Server lag is the steady second complaint', detail: `${lag.people} people describe frame drops in busy lobbies. Replies lean on memes, so treat the sentiment as low confidence.`, severity: 'warn', trend: lag.trend, topicId: lag.id, messageCount: Math.min(12, lag.messages), channel: lag.channel },
    { id: 'ins-timers', title: `${help.label} need a pinned answer`, detail: `${help.people} people asked the same thing after the update. A pinned answer would clear most of it.`, severity: 'info', trend: help.trend, topicId: help.id, messageCount: Math.min(16, help.messages), channel: help.channel },
    { id: 'ins-season', title: `${season.label} have a clear favourite`, detail: `${season.people} people asked for a golden ${game.noun} reveal. The thread is short but unusually positive.`, severity: 'ok', trend: season.trend, topicId: season.id, messageCount: Math.min(9, season.messages), channel: season.channel },
  ]
}

function buildDrama(topics: TopicCluster[], metadataOnly: boolean): DiscordDataset['drama'] {
  const [dupe, cosmetics, scams, help, , lag] = topics
  const checks: DramaCheck[] = [
    {
      id: 'drama-dupe',
      topicId: dupe.id,
      topicLabel: dupe.label,
      last3hPeople: Math.round(dupe.people * 0.55),
      lastWeekPeople: Math.round(dupe.people * 0.2),
      last3hNegative: metadataOnly ? null : 0.71,
      lastWeekNegative: metadataOnly ? null : 0.26,
      verdict: 'alert',
      note: metadataOnly ? 'People posting about this topic are 2.7x last week, counted by author id.' : 'Negative share is 2.7x the same hours last week. Hack Daemon logged a matching exploit surge on Oct 23.',
    },
    {
      id: 'drama-scams',
      topicId: scams.id,
      topicLabel: scams.label,
      last3hPeople: Math.round(scams.people * 0.34),
      lastWeekPeople: Math.round(scams.people * 0.41),
      last3hNegative: metadataOnly ? null : 0.38,
      lastWeekNegative: metadataOnly ? null : 0.47,
      verdict: 'watch',
      note: 'Down from last week but still the second loudest complaint. Trade confirmation shipped Oct 24.',
    },
    {
      id: 'drama-lag',
      topicId: lag.id,
      topicLabel: lag.label,
      last3hPeople: Math.round(lag.people * 0.3),
      lastWeekPeople: Math.round(lag.people * 0.19),
      last3hNegative: metadataOnly ? null : 0.16,
      lastWeekNegative: metadataOnly ? null : 0.12,
      verdict: 'watch',
      note: 'Volume is up but sentiment is flat, so this reads as more players, not a new fault.',
    },
    {
      id: 'drama-help',
      topicId: help.id,
      topicLabel: help.label,
      last3hPeople: Math.round(help.people * 0.28),
      lastWeekPeople: Math.round(help.people * 0.26),
      last3hNegative: metadataOnly ? null : 0.46,
      lastWeekNegative: metadataOnly ? null : 0.48,
      verdict: 'clear',
      note: 'Question volume matches last week and sentiment is neutral.',
    },
    {
      id: 'drama-cosmetics',
      topicId: cosmetics.id,
      topicLabel: cosmetics.label,
      last3hPeople: Math.round(cosmetics.people * 0.22),
      lastWeekPeople: Math.round(cosmetics.people * 0.2),
      last3hNegative: metadataOnly ? null : 0.14,
      lastWeekNegative: metadataOnly ? null : 0.16,
      verdict: 'clear',
      note: 'Steady and positive. Nothing to escalate.',
    },
  ]
  return {
    lastCheckAt: '2026-10-26T14:45:00-06:00',
    nextCheckAt: '2026-10-26T15:00:00-06:00',
    baseline: 'Last 3 hours (12:00 to 15:00) against the same hours on Oct 19',
    checks,
  }
}

function buildRelease(
  game: Game,
  topics: TopicCluster[],
  metadataOnly: boolean,
  heavyMessages: number,
  moodSeries: { date: string; sentiment: number }[],
  totalMessages: number,
): ReleaseReport {
  const [dupe, , scams, help, season] = topics
  const dayVolume = [0.52, 0.62, 0.74, 0.86, 0.98, 0.79, 0.68, 0.71]
  const series = moodSeries.map((point, i) => ({
    day: new Date(point.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    sentiment: metadataOnly ? null : point.sentiment,
    messages: Math.round((totalMessages * dayVolume[i]) / dayVolume.reduce((a, v) => a + v, 0)),
  }))
  return {
    label: `${game.shortName} update`,
    shippedOn: '2026-10-20',
    day: 7,
    summary: metadataOnly
      ? `Seven days of metadata from ${game.shortName}. Volume peaked on Oct 23 and settled back under 600 messages a day. Sentiment is unavailable until MESSAGE_CONTENT is approved.`
      : `Seven days of ${game.shortName}. Volume peaked on Oct 23 with the ${dupe.label.toLowerCase()}, then settled under 600 messages a day as the fix landed.`,
    verdict: metadataOnly
      ? 'Hold. Volume is back to baseline, but the day 7 read on sentiment needs message content.'
      : 'Hold and patch. The dupe fix moved sentiment off the floor, and the remaining drag is trade scams, which are cooling off on their own.',
    shipped: [`Season 2 ${game.noun} rarity tier`, 'Trade confirmation screen', 'Mobile render budget pass'],
    resolved: [
      metadataOnly ? 'Raid cluster excluded, 82 accounts and 1,190 messages' : 'Dupe reports down 68% after the Oct 24 patch',
      metadataOnly ? 'Posting volume back to the pre-update baseline' : 'Trade confirmation shipped to every server',
    ],
    open: [
      `${scams.label} still cooling off`,
      `${topics[5].label} for low-end devices`,
      `${help.label} for new players`,
      `${season.label} needs a decision before season 2`,
      `One poster sent ${heavyMessages.toLocaleString('en-US')} messages, now counted as one voice`,
    ],
    series,
  }
}

function weightedPick(weights: number[], rng: Rng): number {
  const total = weights.reduce((a, w) => a + w, 0) || 1
  let r = rng.next() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

function buildCrowd(
  messages: number,
  accounts: number,
  exclusions: Exclusion[],
  heavyMessages: number,
  topicWeights: number[],
  rng: Rng,
): Crowd {
  const members = Math.max(2, accounts - exclusions.reduce((a, e) => a + e.accounts, 0))
  const people: CrowdPerson[] = []
  const excludedMessages = exclusions.reduce((a, e) => a + e.messages, 0)
  const heavy = Math.min(heavyMessages, Math.max(0, messages - excludedMessages - (members - 1)))
  const remaining = messages - heavy - excludedMessages
  const extra = Math.max(0, remaining - members)
  const weights = Array.from({ length: members - 1 }, () => Math.pow(rng.float(0.25, 1), 2.2))
  const extraSplit = splitTotal(extra, weights)
  let idx = 0
  // Heavy poster first so it owns a stable index and can be labelled in the field.
  people.push({ index: idx++, kind: 'member', messages: Math.max(1, heavy), topicIndex: 0, heavy: true })
  for (let i = 0; i < members - 1; i++) {
    people.push({ index: idx++, kind: 'member', messages: 1 + extraSplit[i], topicIndex: weightedPick(topicWeights, rng), heavy: false })
  }
  for (const ex of exclusions) {
    const weightsEx = Array.from({ length: ex.accounts }, () => rng.float(0.4, 1.6))
    const split = splitTotal(ex.messages, weightsEx)
    for (let i = 0; i < ex.accounts; i++) {
      people.push({ index: idx++, kind: ex.kind, messages: split[i], topicIndex: 0, heavy: false })
    }
  }
  const total = people.reduce((a, p) => a + p.messages, 0)
  return { people, accounts, counted: members, totalMessages: total, heavyIndex: 0 }
}

function baseDataset(game: Game, messageContent: 'approved' | 'denied'): DiscordDataset {
  const metadataOnly = messageContent !== 'approved'
  const rng = createRng('discord-daemon-' + game.id)
  const raw = game.id === 'steal-an-egg' ? heroDataset() : derivedDataset(game, rng)
  const server = serverFor(game, raw.members, 'discord-daemon-' + game.id)
  server.intents.messageContent = messageContent === 'approved' ? 'approved' : 'denied'
  const topics = raw.topics
  const quotes = buildQuotes(game, topics, createRng('discord-daemon-' + game.id + '-quotes'), metadataOnly)
  const channels = [
    { id: 'ch-1', name: '#announcements', messages: Math.round(raw.messages * 0.04) },
    { id: 'ch-2', name: '#general', messages: Math.round(raw.messages * 0.31) },
    { id: 'ch-3', name: '#trading', messages: Math.round(raw.messages * 0.19) },
    { id: 'ch-4', name: '#bugs', messages: Math.round(raw.messages * 0.22) },
    { id: 'ch-5', name: '#help', messages: Math.round(raw.messages * 0.13) },
    { id: 'ch-6', name: '#suggestions', messages: Math.round(raw.messages * 0.11) },
  ]
  const series = [
    { date: '2026-10-19', sentiment: 0.2 },
    { date: '2026-10-20', sentiment: 0.11 },
    { date: '2026-10-21', sentiment: 0.16 },
    { date: '2026-10-22', sentiment: 0.09 },
    { date: '2026-10-23', sentiment: -0.12 },
    { date: '2026-10-24', sentiment: -0.04 },
    { date: '2026-10-25', sentiment: 0.03 },
    { date: '2026-10-26', sentiment: 0.08 },
  ]
  const crowd = buildCrowd(
    raw.messages,
    raw.accounts,
    raw.exclusions,
    raw.heavyMessages,
    topics.map((t) => t.people),
    createRng('discord-daemon-' + game.id + '-crowd'),
  )
  return {
    gameId: game.id,
    server,
    metadataOnly,
    channels,
    window: {
      start: '2026-10-19T15:00:00-06:00',
      end: '2026-10-26T15:00:00-06:00',
      hours: 24,
      messages: raw.messages,
      accounts: raw.accounts,
      people: raw.people,
      negativeMessageShare: raw.negativeMessageShare,
      negativePeopleShare: raw.negativePeopleShare,
      previousNegativePeopleShare: clamp(raw.negativePeopleShare + 0.04, 0.02, 0.6),
    },
    topics,
    mood: { series, drops: raw.drops },
    exclusions: raw.exclusions,
    quotes,
    insights: buildInsights(topics, raw.exclusions, metadataOnly, game),
    drama: buildDrama(topics, metadataOnly),
    release: buildRelease(game, topics, metadataOnly, raw.heavyMessages, series, raw.messages),
    heavyPoster: { handle: raw.heavyHandle, messages: raw.heavyMessages },
    crowd,
  }
}

export function buildDataset(game: Game, messageContent: 'approved' | 'denied' = 'approved'): DiscordDataset {
  return baseDataset(game, messageContent)
}

export function topicById(dataset: DiscordDataset, id: string): TopicCluster | undefined {
  return dataset.topics.find((t) => t.id === id)
}

export function quotesFor(dataset: DiscordDataset, topicId: string | null, limit = 24): MessageQuote[] {
  const pool = topicId ? dataset.quotes.filter((q) => q.topicId === topicId) : dataset.quotes
  return pool.slice(0, limit)
}

export function sentimentTone(value: number): 'live' | 'warn' | 'danger' {
  if (value <= -0.25) return 'danger'
  if (value < 0.15) return 'warn'
  return 'live'
}

export function trendTone(trend: Trend): 'live' | 'warn' | 'danger' {
  if (trend === 'getting worse') return 'danger'
  if (trend === 'cooling off') return 'warn'
  return 'live'
}

export function severityTone(severity: Severity): 'accent' | 'live' | 'warn' | 'danger' {
  if (severity === 'danger') return 'danger'
  if (severity === 'warn') return 'warn'
  if (severity === 'ok') return 'live'
  return 'accent'
}

export function exclusionTotals(exclusions: Exclusion[]) {
  return {
    accounts: exclusions.reduce((a, e) => a + e.accounts, 0),
    messages: exclusions.reduce((a, e) => a + e.messages, 0),
  }
}
