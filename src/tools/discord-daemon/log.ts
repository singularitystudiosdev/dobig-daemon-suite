import type { LogLevel } from '@/components/ui'
import type { DiscordDataset } from './data'

/* The run log. Every line carries an absolute script offset so the stream is revealed by
   `revealed(lines, sim)` and never grows on its own clock. Traffic mirrors the real Discord
   REST surface: channel message pages at limit=100, one 429 with retry_after, the rate-limit
   headers, and the privileged intent handshake. */

export interface ScriptedLogLine {
  id: string
  at: number
  level: LogLevel
  text: string
}

export function logFor(dataset: DiscordDataset): ScriptedLogLine[] {
  const g = dataset.server.guildId
  const channelId = (n: number) => String(Number(g.slice(0, 12)) + n * 7919)
  const topic = (id: string) => dataset.topics.find((t) => t.id === id)
  const dupe = topic('golden-egg-dupe') ?? dataset.topics[0]
  const lag = topic('mobile-lag') ?? dataset.topics[5]
  const scams = topic('trade-scams') ?? dataset.topics[2]
  const denied = dataset.metadataOnly
  const fmt = (n: number) => n.toLocaleString('en-US')
  const lines: ScriptedLogLine[] = [
    { id: 'l1', at: 40, level: 'cmd', text: `GET /api/v10/gateway/bot` },
    { id: 'l2', at: 120, level: 'info', text: `200 shards=2 session_start_limit.remaining=994` },
    { id: 'l3', at: 260, level: 'cmd', text: `IDENTIFY intents=33281 GUILD_MESSAGES|MESSAGE_CONTENT|MESSAGE_REACTIONS` },
    { id: 'l4', at: 380, level: 'ok', text: `READY guilds=1 v10 gateway=wss://gateway.discord.gg` },
    { id: 'l5', at: 520, level: 'cmd', text: `GET /api/v10/guilds/${g}` },
    { id: 'l6', at: 620, level: 'info', text: `200 name="${dataset.server.name}" members=${fmt(dataset.server.members)}` },
    { id: 'l7', at: 760, level: 'cmd', text: `GET /api/v10/guilds/${g}/channels` },
    { id: 'l8', at: 880, level: 'info', text: `200 ${dataset.channels.length} text channels in scope` },
    { id: 'l9', at: 1040, level: 'ok', text: `GUILD_MESSAGES (1<<9) granted` },
    {
      id: 'l10',
      at: 1260,
      level: denied ? 'warn' : 'ok',
      text: denied ? `MESSAGE_CONTENT (1<<15) not approved: content arrives empty` : `MESSAGE_CONTENT (1<<15) approved, privileged intent active`,
    },
    { id: 'l11', at: 1480, level: 'warn', text: `4014 handler armed: fall back to metadata-only analytics` },
    { id: 'l12', at: 1740, level: 'ok', text: `READ_MESSAGE_HISTORY granted, window 7d` },
    { id: 'l13', at: 1960, level: 'dim', text: `window 2026-10-19 15:00 to 2026-10-26 15:00 (America/Denver)` },

    { id: 'l20', at: 2080, level: 'cmd', text: `GET /api/v10/channels/${channelId(1)}/messages?limit=100` },
    { id: 'l21', at: 2160, level: 'info', text: `200 count=100 X-RateLimit-Remaining=4 X-RateLimit-Reset-After=0.41` },
    { id: 'l22', at: 2360, level: 'cmd', text: `GET /api/v10/channels/${channelId(2)}/messages?limit=100` },
    { id: 'l23', at: 2440, level: 'info', text: `200 count=100 X-RateLimit-Remaining=3` },
    { id: 'l24', at: 2700, level: 'cmd', text: `GET /api/v10/channels/${channelId(3)}/messages?limit=100` },
    { id: 'l25', at: 2790, level: 'info', text: `200 count=100 X-RateLimit-Remaining=1 bucket=channel:${channelId(3)}` },
    { id: 'l26', at: 3020, level: 'error', text: `429 rate limited retry_after=1.2 global=false bucket=channel:${channelId(3)}` },
    { id: 'l27', at: 3040, level: 'warn', text: `X-RateLimit-Remaining=0, waiting 1.2s before retry` },
    { id: 'l28', at: 4250, level: 'cmd', text: `GET /api/v10/channels/${channelId(3)}/messages?limit=100` },
    { id: 'l29', at: 4330, level: 'ok', text: `200 count=100 resumed after retry, 0 messages lost` },
    { id: 'l30', at: 4700, level: 'cmd', text: `GET /api/v10/channels/${channelId(4)}/messages?limit=100` },
    { id: 'l31', at: 4780, level: 'info', text: `200 count=100 X-RateLimit-Remaining=2` },
    { id: 'l32', at: 5100, level: 'cmd', text: `GET /api/v10/channels/${channelId(5)}/messages?limit=100` },
    { id: 'l33', at: 5180, level: 'info', text: `200 count=100 X-RateLimit-Remaining=2` },
    { id: 'l34', at: 5400, level: 'ok', text: `backfill complete: ${fmt(dataset.window.messages)} messages, ${dataset.channels.length} channels, 1 retry` },

    { id: 'l40', at: 5580, level: 'cmd', text: `GET /api/v10/guilds/${g}/members?limit=1000` },
    { id: 'l41', at: 5900, level: 'info', text: `dedupe authors: ${fmt(dataset.window.messages)} messages to ${fmt(dataset.window.accounts)} accounts` },
    { id: 'l42', at: 6300, level: 'info', text: `weighting: one account, one vote` },
    { id: 'l43', at: 6800, level: 'warn', text: `heavy poster ${dataset.heavyPoster.handle} sent ${fmt(dataset.heavyPoster.messages)} messages, counted once` },
    { id: 'l44', at: 7400, level: 'info', text: `excluded ${dataset.exclusions.map((e) => `${e.accounts} ${e.kind}`).join(', ')}` },
    { id: 'l45', at: 8100, level: 'ok', text: `${fmt(dataset.window.people)} people counted from ${fmt(dataset.window.accounts)} accounts` },
    denied
      ? { id: 'l46', at: 8900, level: 'warn', text: `4014: sentiment unavailable, content fields empty` }
      : { id: 'l46', at: 8900, level: 'ok', text: `negative share 38% by message, 14% by person` },

    { id: 'l50', at: 9600, level: 'cmd', text: `POST /v1/cluster {unit: "person", window: "7d"}` },
    { id: 'l51', at: 10300, level: 'info', text: `6 topic clusters, silhouette 0.61` },
    { id: 'l52', at: 11000, level: 'info', text: `category map: Issues & Bugs 3, User Feedback 1, General Questions 1, Marketing Ideas 1` },
    { id: 'l53', at: 12100, level: 'warn', text: `${lag.label.toLowerCase()}: emoji-heavy replies, sarcasm flag set, confidence low` },
    { id: 'l54', at: 13100, level: 'ok', text: `cluster graph ready, ${fmt(dupe.messages)} messages in the largest topic` },

    { id: 'l60', at: 13600, level: 'cmd', text: `GET /api/v10/guilds/${g}/messages?after=2026-10-19T15:00Z&limit=100` },
    { id: 'l61', at: 14400, level: 'info', text: `daily sentiment series, 7 points, people-weighted` },
    { id: 'l62', at: 15200, level: 'warn', text: `dip 2026-10-23 delta=-0.21, 64% of the drop inside ${dupe.channel}` },
    { id: 'l63', at: 16000, level: 'info', text: `cause rank: ${dupe.label.toLowerCase()} 64%, ${lag.label.toLowerCase()} 22%, ${scams.label.toLowerCase()} 9%` },
    { id: 'l64', at: 16600, level: 'ok', text: `bus: hack-daemon exploit surge 18 videos 1.4M views, cause confirmed` },

    { id: 'l70', at: 17100, level: 'cmd', text: `POST /v1/summary {window: "24h", format: "nightly"}` },
    { id: 'l71', at: 18000, level: 'info', text: `6 insights ranked, every insight linked to source message ids` },
    { id: 'l72', at: 18800, level: 'ok', text: `summary ready in 812ms, ${fmt(dataset.window.people)} people, zero message bodies stored` },
  ]
  return lines
}
