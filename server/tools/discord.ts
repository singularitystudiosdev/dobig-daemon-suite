import { DEFAULT_ANALYSIS_MODEL } from '../llm.ts'
import { RunError, type RouteContext, type RunContext, type ToolModule } from './types.ts'
import type { DiscordServerInfo, RunSummary } from '../../src/lib/runTypes.ts'
import {
  botInviteUrl,
  cdnBase,
  createDiscordClient,
  DiscordHttpError,
  intentSettingsUrl,
  scrubToken,
  snowflakeCompare,
  snowflakeTime,
  STAFF_BITS,
  apiBase,
  type DChannel,
  type DClient,
  type DGuild,
  type DMember,
  type DMessage,
  type DRole,
  type DUser,
} from '../discord/client.ts'
import { aggregate, BATCH_SIZE, buildFindings, cleanContent, detectRaid, MIN_PEOPLE_PER_FLAG, scoreMessages, type Msg, type PrevTopic, type RaidRow } from '../discord/analysis.ts'

/* Discord Daemon: reads recent messages of a community server through the owner's own bot and reports sentiment
   counted per PERSON. The routes resolve a public invite (no token), report whether the bot is ready, and store or
   remove the bot token. The analyzer never reads DMs and never keeps message text beyond the run: ctx.memory holds
   topic scores only. */

const SNOWFLAKE = /^\d{5,25}$/
const CODE = /^[A-Za-z0-9-]{2,32}$/
const MAX_CHANNELS = 10
const MESSAGES_PER_CHANNEL = 300
const STAFF_LOOKUPS = 80
const RAID_EXTRA_LOOKUPS = 40
const TOKEN_HELP = 'In the Discord Developer Portal open your application, choose Bot, press Reset Token and paste the new token here. It is shown only once.'

/* ---- links ---- */

/** Pulls the invite code out of a pasted link or bare code. Tracking params and fragments are ignored. */
export function parseInviteCode(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let code: string | null = null
  if (/^[A-Za-z0-9-]+$/.test(raw)) code = raw
  else {
    let u: URL
    try {
      u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    } catch {
      return null
    }
    const host = u.hostname.toLowerCase().replace(/^(www|canary|ptb)\./, '')
    const parts = u.pathname.split('/').filter(Boolean)
    if (host === 'discord.gg') code = parts[0] === 'invite' ? (parts[1] ?? null) : (parts[0] ?? null)
    else if (host === 'discord.com' || host === 'discordapp.com') code = parts[0] === 'invite' ? (parts[1] ?? null) : null
  }
  return code && CODE.test(code) ? code : null
}

/* ---- resolve ---- */

interface InviteBody {
  code?: string
  guild?: { id?: string; name?: string; description?: string | null; icon?: string | null; banner?: string | null; features?: string[] }
  approximate_member_count?: number
  approximate_presence_count?: number
  expires_at?: string | null
}

const resolveCache = new Map<string, { at: number; server: DiscordServerInfo }>()

export function inviteToServer(code: string, body: InviteBody): DiscordServerInfo | null {
  const g = body.guild
  if (!g?.id || !g.name || !/^\d{5,25}$/.test(g.id)) return null
  const cdn = cdnBase()
  return {
    guildId: g.id,
    inviteCode: code,
    name: g.name,
    description: g.description?.trim() || null,
    iconUrl: g.icon ? `${cdn}/icons/${g.id}/${g.icon}.png?size=128` : null,
    bannerUrl: g.banner ? `${cdn}/banners/${g.id}/${g.banner}.png?size=1024` : null,
    members: typeof body.approximate_member_count === 'number' ? body.approximate_member_count : null,
    online: typeof body.approximate_presence_count === 'number' ? body.approximate_presence_count : null,
    features: Array.isArray(g.features) ? g.features.filter((f) => typeof f === 'string') : [],
    url: `https://discord.gg/${code}`,
  }
}

async function resolve(ctx: RouteContext) {
  const code = parseInviteCode(ctx.url.searchParams.get('link') ?? '')
  if (!code) {
    return ctx.json(400, { ok: false, code: 'bad-link', message: 'That does not look like a Discord invite. Paste a link like https://discord.gg/abc123, or just the code after the slash.' })
  }
  const hit = resolveCache.get(code)
  if (hit && Date.now() - hit.at < 5 * 60_000) return ctx.json(200, { ok: true, server: hit.server })
  let res: Response
  try {
    res = await fetch(`${apiBase()}/invites/${encodeURIComponent(code)}?with_counts=true`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  } catch {
    return ctx.json(502, { ok: false, code: 'upstream', message: 'Discord did not answer. Check your connection and try again in a moment.' })
  }
  if (res.status === 404) {
    return ctx.json(404, {
      ok: false,
      code: 'not-found',
      message: 'Discord says this invite has expired or was deleted. Ask a server admin for a permanent invite (Invite People, then Edit invite link, Expire after: Never) and paste that.',
    })
  }
  if (res.status === 429) {
    const retry = Math.ceil(Number(res.headers.get('retry-after')) || 5)
    return ctx.json(429, { ok: false, code: 'rate-limited', message: 'Discord is limiting invite lookups right now.', retryAfter: retry })
  }
  if (!res.ok) return ctx.json(502, { ok: false, code: 'upstream', message: `Discord answered ${res.status} for that invite. Try again in a moment.` })
  const body = (await res.json().catch(() => null)) as InviteBody | null
  const server = body ? inviteToServer(code, body) : null
  if (!server) return ctx.json(404, { ok: false, code: 'not-found', message: 'That invite is not for a server (it may be a group chat or friend invite). Paste a server invite.' })
  resolveCache.set(code, { at: Date.now(), server })
  return ctx.json(200, { ok: true, server })
}

/* ---- bot identity, status, token ---- */

interface BotIdentity {
  bot: { username: string; id: string }
  applicationId: string
}

const identityCache = new Map<string, { at: number; value: BotIdentity }>()

/** GET /users/@me and /applications/@me with the token. Throws DiscordHttpError (401 = wrong token). */
async function loadIdentity(token: string, fresh = false): Promise<BotIdentity> {
  const hit = identityCache.get(token)
  if (!fresh && hit && Date.now() - hit.at < 5 * 60_000) return hit.value
  const client = createDiscordClient(token)
  const me = await client.get<DUser>('/users/@me')
  const app = await client.get<{ id: string }>('/applications/@me')
  const value = { bot: { username: me.username, id: me.id }, applicationId: String(app.id) }
  identityCache.set(token, { at: Date.now(), value })
  return value
}

async function botStatus(ctx: RouteContext) {
  const guildId = ctx.url.searchParams.get('guildId') ?? ''
  const token = ctx.secrets.get('discord-bot-token')
  const none = { tokenSet: false, tokenValid: null as boolean | null, bot: null, applicationId: null, inGuild: null, inviteUrl: null, intent: 'unknown' as const }
  if (!token) return ctx.json(200, none)
  let identity: BotIdentity
  try {
    identity = await loadIdentity(token)
  } catch (err) {
    const bad = err instanceof DiscordHttpError && err.status === 401
    return ctx.json(200, { ...none, tokenSet: true, tokenValid: bad ? false : null })
  }
  let inGuild: boolean | null = null
  if (SNOWFLAKE.test(guildId)) {
    try {
      await createDiscordClient(token).get<DGuild>(`/guilds/${guildId}`)
      inGuild = true
    } catch (err) {
      inGuild = err instanceof DiscordHttpError && (err.status === 403 || err.status === 404) ? false : null
    }
  }
  return ctx.json(200, { tokenSet: true, tokenValid: true, bot: identity.bot, applicationId: identity.applicationId, inGuild, inviteUrl: botInviteUrl(identity.applicationId), intent: 'unknown' })
}

async function saveToken(ctx: RouteContext) {
  const body = (await ctx.body().catch(() => undefined)) as { token?: unknown } | undefined
  const raw = typeof body?.token === 'string' ? body.token.trim().replace(/^Bot\s+/i, '') : ''
  if (!raw) return ctx.json(400, { ok: false, code: 'bad-token', message: `Paste the bot token first. ${TOKEN_HELP}` })
  if (raw.length < 20 || raw.length > 200 || /\s/.test(raw)) {
    return ctx.json(400, { ok: false, code: 'bad-token', message: `That does not look like a bot token (they are one long string with no spaces). ${TOKEN_HELP}` })
  }
  try {
    const identity = await loadIdentity(raw, true)
    await ctx.secrets.set('discord-bot-token', raw)
    return ctx.json(200, { ok: true, bot: identity.bot, applicationId: identity.applicationId })
  } catch (err) {
    if (err instanceof DiscordHttpError) {
      if (err.status === 401) return ctx.json(401, { ok: false, code: 'bad-token', message: `Discord says that token is wrong. ${TOKEN_HELP}` })
      if (err.status === 429) return ctx.json(429, { ok: false, code: 'rate-limited', message: 'Discord is limiting requests right now. Wait a few seconds and press Save again.', retryAfter: Math.ceil(err.retryAfter ?? 5) })
      return ctx.json(502, { ok: false, code: 'upstream', message: scrubToken(err.status === 0 ? err.message : `Discord answered ${err.status} while checking the token. Try again in a moment.`, raw) })
    }
    return ctx.json(500, { ok: false, code: 'upstream', message: 'Checking the token failed. Try again in a moment.' })
  }
}

async function removeToken(ctx: RouteContext) {
  await ctx.secrets.remove('discord-bot-token')
  identityCache.clear()
  return ctx.json(200, { ok: true })
}

/* ---- the analyzer ---- */

type Reporter = Pick<RunContext, 'step'>

function mapDiscordError(err: unknown, token: string, what: string): never {
  if (err instanceof RunError) throw err
  if (err instanceof DiscordHttpError) {
    if (err.status === 401) throw new RunError('no-discord-token', `Discord rejected the saved bot token while ${what}. Add the token again.`, { kind: 'add-discord-token', label: 'Add the bot token' })
    if (err.status === 429) throw new RunError('rate-limited', `Discord is rate limiting the bot (try again in about ${Math.ceil(err.retryAfter ?? 60)} seconds).`, { kind: 'retry', label: 'Try again' })
    throw new RunError('upstream', scrubToken(err.status === 0 ? err.message : `Discord answered ${err.status} while ${what}: ${err.message}`, token).slice(0, 240), { kind: 'retry', label: 'Try again' })
  }
  throw err
}

const MESSAGE_TYPES = new Set([0, 19])
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fmtDayShort = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const num = (n: number) => n.toLocaleString('en-US')

async function readChannel(client: DClient, channel: DChannel, onPage: (n: number) => void): Promise<DMessage[]> {
  const out: DMessage[] = []
  let before: string | undefined
  while (out.length < MESSAGES_PER_CHANNEL) {
    const page = await client.get<DMessage[]>(`/channels/${channel.id}/messages`, { limit: 100, before })
    if (!Array.isArray(page) || page.length === 0) break
    out.push(...page)
    onPage(out.length)
    if (page.length < 100) break
    before = page.reduce((min, m) => (snowflakeCompare(m.id, min) < 0 ? m.id : min), page[0].id)
  }
  return out.slice(0, MESSAGES_PER_CHANNEL)
}

async function analyze(ctx: RunContext): Promise<void> {
  const target = ctx.target
  if (target.kind !== 'discord-server') throw new RunError('bad-input', 'The Discord Daemon needs a Discord server as its target.')
  const guildId = target.guildId
  if (!SNOWFLAKE.test(guildId)) throw new RunError('bad-input', 'The server id on this daemon is not valid. Remove it and add the server again.')

  /* a. token */
  ctx.step('token', 'Checking the bot token', 'active')
  const token = ctx.secrets.get('discord-bot-token')
  if (!token) {
    ctx.step('token', 'Checking the bot token', 'failed', 'No bot token saved')
    throw new RunError('no-discord-token', 'The Discord Daemon reads your server through a bot you own. Add the bot token to start.', { kind: 'add-discord-token', label: 'Add the bot token' })
  }
  const client = createDiscordClient(token, ctx.signal, (ms, why) => ctx.step('messages', 'Reading recent messages', 'active', `Waiting ${(ms / 1000).toFixed(1)}s for Discord (${why})`))
  const fail = (err: unknown, what: string): never => mapDiscordError(err, token, what)

  let me: DUser
  let applicationId: string
  try {
    me = await client.get<DUser>('/users/@me')
    applicationId = String((await client.get<{ id: string }>('/applications/@me')).id)
  } catch (err) {
    ctx.step('token', 'Checking the bot token', 'failed', err instanceof DiscordHttpError && err.status === 401 ? 'Discord rejected the token' : undefined)
    return fail(err, 'checking the bot token')
  }
  ctx.step('token', 'Checking the bot token', 'done', `Signed in as ${me.username}`)

  /* b. guild */
  ctx.step('guild', `Opening ${target.name}`, 'active')
  let guild: DGuild
  try {
    guild = await client.get<DGuild>(`/guilds/${guildId}`)
  } catch (err) {
    if (err instanceof DiscordHttpError && (err.status === 403 || err.status === 404)) {
      ctx.step('guild', `Opening ${target.name}`, 'failed', 'The bot is not in this server')
      throw new RunError('discord-bot-missing', `Add the bot to ${target.name}. It is not a member yet, so it cannot read anything. Use the button, pick the server, then run again.`, {
        kind: 'open-url',
        label: `Add the bot to ${target.name}`,
        url: botInviteUrl(applicationId),
      })
    }
    ctx.step('guild', `Opening ${target.name}`, 'failed')
    return fail(err, 'opening the server')
  }
  ctx.step('guild', `Opening ${target.name}`, 'done', guild.name)

  /* c. channels */
  ctx.step('channels', 'Listing channels', 'active')
  let channels: DChannel[]
  try {
    channels = await client.get<DChannel[]>(`/guilds/${guildId}/channels`)
  } catch (err) {
    ctx.step('channels', 'Listing channels', 'failed')
    return fail(err, 'listing channels')
  }
  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5)
  const withActivity = textChannels.filter((c) => c.last_message_id).sort((a, b) => snowflakeCompare(b.last_message_id!, a.last_message_id!))
  ctx.step('channels', 'Listing channels', 'done', `${textChannels.length} text channels, ${withActivity.length} with messages`)

  /* d. messages, most recently active channels first */
  ctx.step('messages', 'Reading recent messages', 'active', 'Starting')
  const collected: { channel: DChannel; messages: DMessage[] }[] = []
  let noAccess = 0
  let total = 0
  for (const channel of withActivity) {
    if (collected.length >= MAX_CHANNELS) break
    try {
      const messages = await readChannel(client, channel, (n) => ctx.step('messages', 'Reading recent messages', 'active', `#${channel.name ?? channel.id}: ${n} messages, ${num(total + n)} so far`))
      total += messages.length
      collected.push({ channel, messages })
    } catch (err) {
      if (err instanceof DiscordHttpError && (err.status === 403 || err.status === 404)) {
        noAccess++
        continue
      }
      ctx.step('messages', 'Reading recent messages', 'failed')
      return fail(err, `reading #${channel.name ?? channel.id}`)
    }
  }
  const all: { m: DMessage; channelName: string }[] = []
  for (const { channel, messages } of collected) for (const m of messages) if (MESSAGE_TYPES.has(m.type ?? 0) && m.author && !m.author.system) all.push({ m, channelName: channel.name ?? channel.id })
  const times = all.map((x) => Date.parse(x.m.timestamp)).filter(Number.isFinite)
  const windowStart = times.length ? Math.min(...times) : null
  const windowEnd = times.length ? Math.max(...times) : null
  ctx.step('messages', 'Reading recent messages', 'done', `${num(all.length)} messages from ${collected.length} channels${client.stats.rateLimited ? `, waited out ${client.stats.rateLimited} rate limit${client.stats.rateLimited === 1 ? '' : 's'}` : ''}`)

  /* e. is the message content readable? */
  const isBotMsg = (m: DMessage) => Boolean(m.author.bot) || Boolean(m.webhook_id)
  const humans = all.filter((x) => !isBotMsg(x.m))
  const mentionsBot = (m: DMessage) => (m.mentions ?? []).some((u) => u.id === me.id)
  // Without the intent Discord still sends content for messages that mention the bot, so those do not prove it is on.
  const readable = humans.filter((x) => x.m.content.trim() !== '' && !mentionsBot(x.m))
  if (humans.length > 0 && readable.length === 0) {
    ctx.step('intent', 'Checking that messages are readable', 'failed', `All ${num(humans.length)} messages came back blank`)
    throw new RunError('discord-intent', 'Every message came back empty, so the bot cannot read what people write. Turn on MESSAGE CONTENT INTENT for the bot in the Developer Portal (Bot, Privileged Gateway Intents), then run again.', {
      kind: 'open-url',
      label: 'Open the bot settings',
      url: intentSettingsUrl(applicationId),
    })
  }

  const notices: { lead: string; body: string }[] = []
  const notes: string[] = []
  if (windowStart !== null && windowEnd !== null) {
    const span = fmtDay(windowStart) === fmtDay(windowEnd) ? fmtDay(windowStart) : `${fmtDayShort(windowStart)} to ${fmtDay(windowEnd)}`
    notes.push(`Window: ${span}, the span of the ${num(all.length)} messages actually read (up to ${MESSAGES_PER_CHANNEL} in each of the ${MAX_CHANNELS} most recently active channels).`)
  }
  notes.push('Counts each person once, not each message. A person\'s stance on a topic is the majority of their messages, weighted by intensity.')
  if (noAccess > 0) notices.push({ lead: `${noAccess} ${noAccess === 1 ? 'channel was' : 'channels were'} skipped.`, body: 'The bot cannot view them. Give the bot View Channel and Read Message History there to include them.' })
  if (humans.length > readable.length * 2 && humans.length >= 20 && readable.length / humans.length < 0.5) {
    notices.push({ lead: 'Many messages were blank.', body: `${num(humans.length - readable.length)} of ${num(humans.length)} messages had no text. If your members mostly write text, check that MESSAGE CONTENT INTENT is on for the bot.` })
  }

  if (humans.length === 0) {
    ctx.summary({
      items: [
        { label: 'People counted', value: '0' },
        { label: 'Messages read', value: num(all.length) },
        { label: 'Negative share of people', value: 'Not available' },
        { label: 'Channels read', value: String(collected.length) },
      ],
      sortLabel: 'Strongest negative sentiment first',
      notes: [...notes, 'No people have posted in the channels the bot can read, so there is nothing to score.'],
      notices,
    })
    ctx.memory.set('topics', {})
    return
  }

  /* f. people, not messages */
  ctx.step('people', 'Counting people', 'active', 'Grouping messages by author')
  const byAuthor = new Map<string, { user: DUser; items: typeof humans }>()
  for (const x of readable) {
    const e = byAuthor.get(x.m.author.id) ?? { user: x.m.author, items: [] }
    e.items.push(x)
    byAuthor.set(x.m.author.id, e)
  }
  const botAuthors = new Set(all.filter((x) => isBotMsg(x.m)).map((x) => x.m.author.id))
  const ranked = [...byAuthor.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[0].localeCompare(b[0]))
  const firstPost = (id: string) => Math.min(...byAuthor.get(id)!.items.map((x) => Date.parse(x.m.timestamp)))

  // Staff: roles with Administrator, Manage Messages, Kick, Ban or Manage Guild.
  let staffRoles: Set<string> | null = null
  try {
    const roles = await client.get<DRole[]>(`/guilds/${guildId}/roles`)
    staffRoles = new Set(roles.filter((r) => r.id !== guildId && (BigInt(r.permissions || '0') & STAFF_BITS) !== 0n).map((r) => r.id))
  } catch (err) {
    if (err instanceof RunError) throw err
    if (err instanceof DiscordHttpError && err.status === 401) return fail(err, 'reading roles')
    staffRoles = null
  }
  // Members for the 80 most active authors (staff and raid checks) plus recent accounts (raid check only).
  const lookup: string[] = ranked.slice(0, STAFF_LOOKUPS).map(([id]) => id)
  const extra = ranked
    .slice(STAFF_LOOKUPS)
    .filter(([id]) => firstPost(id) - snowflakeTime(id) < 7 * 86_400_000)
    .slice(0, RAID_EXTRA_LOOKUPS)
    .map(([id]) => id)
  const members = new Map<string, DMember>()
  let left = 0
  let memberErrors = 0
  for (const [i, id] of [...lookup, ...extra].entries()) {
    if (ctx.signal.aborted) throw new RunError('aborted', 'The run was cancelled.')
    if (memberErrors >= 3) break
    try {
      members.set(id, await client.get<DMember>(`/guilds/${guildId}/members/${id}`))
    } catch (err) {
      if (err instanceof RunError) throw err
      if (err instanceof DiscordHttpError && err.status === 404) left++
      else if (err instanceof DiscordHttpError && err.status === 401) return fail(err, 'reading members')
      else memberErrors++
    }
    if (i % 10 === 9) ctx.step('people', 'Counting people', 'active', `Checked roles of ${i + 1} of ${lookup.length + extra.length} authors`)
  }
  const staff = new Set<string>()
  for (const [id, mem] of members) {
    if (staffRoles && mem.roles.some((r) => staffRoles!.has(r))) staff.add(id)
  }
  if (guild.owner_id && byAuthor.has(guild.owner_id)) staff.add(guild.owner_id)

  const raidRows: RaidRow[] = []
  for (const [id, mem] of members) {
    const joinedAt = mem.joined_at ? Date.parse(mem.joined_at) : NaN
    if (Number.isFinite(joinedAt)) raidRows.push({ id, createdAt: snowflakeTime(id), joinedAt, firstPostAt: firstPost(id) })
  }
  const raid = raidRows.length > 0 ? detectRaid(raidRows.filter((r) => !staff.has(r.id))) : new Set<string>()

  const counted = ranked.filter(([id]) => !staff.has(id) && !raid.has(id))
  const excluded = botAuthors.size + staff.size + raid.size
  const staffNote = staffRoles
    ? 'Staff detection: people with a role that has Administrator, Manage Messages, Kick, Ban or Manage Server (and the server owner) are set aside. It checks the 80 most active authors only, so a quiet moderator may still be counted.'
    : 'Staff detection was not possible because Discord would not list the server roles for this bot, so staff messages are included. Give the bot permission to see roles to turn it on.'
  notes.push(staffNote)
  if (raidRows.length === 0) notes.push('Raid check skipped: Discord did not give join dates for these members.')
  else notes.push(raid.size > 0 ? `Raid check: ${raid.size} accounts created within an hour of each other that posted within minutes of joining were set aside.` : 'Raid check: no burst of new accounts was found among the authors checked.')
  if (memberErrors >= 3) notices.push({ lead: 'Member lookups stopped early.', body: 'Discord refused several member lookups, so staff and raid detection covers fewer authors than usual.' })
  ctx.step('people', 'Counting people', 'done', `${counted.length} people counted; set aside ${botAuthors.size} bots, ${staff.size} staff, ${raid.size} raid accounts${left ? `; ${left} authors have left the server` : ''}`)

  /* g. sentiment */
  const toScore: Msg[] = []
  const names = new Map<string, string>()
  const nameOf = (u: DUser) => u.global_name?.trim() || u.username
  for (const [id, e] of counted) {
    names.set(id, nameOf(e.user))
    for (const x of e.items) {
      if (x.m.content.trim() === '' || mentionsBot(x.m)) continue
      const { text, hadUserMention } = cleanContent(x.m.content)
      if (!text) continue
      toScore.push({ id: x.m.id, channelId: x.m.channel_id, channelName: x.channelName, authorId: id, text, at: Date.parse(x.m.timestamp), ts: x.m.timestamp, hadUserMention })
    }
  }
  toScore.sort((a, b) => snowflakeCompare(a.id, b.id))
  const prevMemory = ctx.memory.get<Record<string, PrevTopic>>('topics')
  const prevFromFindings = (): Record<string, PrevTopic> | null => {
    if (ctx.previous.length === 0) return null
    const out: Record<string, PrevTopic> = {}
    for (const f of ctx.previous) if (f.detail.kind === 'sentiment') out[f.id.replace(/^sent:/, '')] = { topic: f.detail.topic, score: f.detail.score }
    return out
  }
  const prev = prevMemory && typeof prevMemory === 'object' ? prevMemory : prevFromFindings()

  ctx.step('sentiment', 'Scoring sentiment', 'active', `${num(toScore.length)} messages from ${counted.length} people`)
  const { scored, stats } = await scoreMessages(ctx.llm, toScore, {
    knownTopics: prev ? Object.values(prev).map((p) => p.topic) : [],
    signal: ctx.signal,
    onProgress: (done, totalBatches) => ctx.step('sentiment', 'Scoring sentiment', 'active', `Batch ${done} of ${totalBatches}, ${num(Math.min(done * BATCH_SIZE, toScore.length))} of ${num(toScore.length)} messages`),
  })
  ctx.step('sentiment', 'Scoring sentiment', stats.failedBatches > 0 ? 'warn' : 'done', `${num(scored.length)} messages scored${stats.unscored ? `, ${num(stats.unscored)} left unscored` : ''} by ${ctx.llm.model || DEFAULT_ANALYSIS_MODEL}`)
  if (stats.failedBatches > 0) notices.push({ lead: `${stats.failedBatches} of ${stats.batches} scoring batches failed twice.`, body: `Those ${num(stats.unscored)} messages are marked unscored and left out. They were not guessed. Last error: ${stats.lastError || 'unknown'}. Run again to retry.` })

  /* h. people and topics */
  ctx.step('topics', 'Grouping by topic', 'active')
  const agg = aggregate(scored, names, guildId)
  const result = buildFindings(agg.topics, prev)
  ctx.step('topics', 'Grouping by topic', 'done', `${agg.topics.length} topics, ${result.findings.length} with at least ${MIN_PEOPLE_PER_FLAG} people`)

  /* i. trend */
  if (result.shifts > 0) {
    notices.push({ lead: `${result.shifts} ${result.shifts === 1 ? 'topic shifted' : 'topics shifted'} since the last run.`, body: 'A score fell by 0.25 or more, or a new strongly negative topic appeared. They are listed after the negative topics.' })
  }
  if (agg.offTopic > 0) notes.push(`${num(agg.offTopic)} messages were chat that is not about the game (greetings, memes) and are left out of topics.`)
  if (result.folded.topics > 0) notes.push(`${result.folded.topics} ${result.folded.topics === 1 ? 'topic has' : 'topics have'} fewer than ${MIN_PEOPLE_PER_FLAG} people and ${result.folded.topics === 1 ? 'is' : 'are'} folded into an Other count, not flagged.`)
  const pct = agg.withStance > 0 ? Math.round((agg.negativePeople / agg.withStance) * 100) : null
  notes.push(pct === null ? 'Negative share is not available because nobody wrote about the game in what was read.' : `Negative share is of the ${num(agg.withStance)} people who wrote about the game in the messages read. It is not the server's overall mood.`)

  const summary: RunSummary = {
    items: [
      { label: 'People counted', value: num(counted.length) },
      { label: 'Messages read', value: num(all.length) },
      { label: 'Negative share of people', value: pct === null ? 'Not available' : `${pct}%`, tone: pct === null ? undefined : pct >= 35 ? 'danger' : pct >= 20 ? 'warn' : 'live' },
      { label: 'Excluded: staff, raids, bots', value: num(excluded) },
      { label: 'Channels read', value: String(collected.length) },
    ],
    sortLabel: 'Strongest negative sentiment first',
    groups: [
      { id: 'negative', label: 'Negative' },
      { id: 'shifts', label: 'Shifts' },
      { id: 'mixed', label: 'Mixed' },
      { id: 'positive', label: 'Positive' },
      { id: 'neutral', label: 'Neutral' },
    ],
    notices,
    notes,
  }
  ctx.summary(summary)
  for (const f of result.findings) ctx.finding(f)

  // Memory keeps topic scores only, never message text.
  const memory: Record<string, PrevTopic> = {}
  for (const t of agg.topics) memory[t.slug] = { topic: t.topic, score: t.score }
  ctx.memory.set('topics', memory)
}

export const tool: ToolModule = {
  analyze,
  routes: {
    'GET /api/discord/resolve': resolve,
    'GET /api/discord/bot-status': botStatus,
    'POST /api/discord/token': saveToken,
    'DELETE /api/discord/token': removeToken,
  },
}
