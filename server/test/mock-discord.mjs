// Mock of the Discord REST endpoints the Discord Daemon uses, with one seeded fixture guild and the real error behaviours.
// Point the app at it with DISCORD_API_BASE=http://127.0.0.1:5198 (and DISCORD_CDN_BASE=http://127.0.0.1:5198/cdn for icons).
//
// Endpoints (an optional /api/v10 prefix is accepted):
//   GET /invites/{code}?with_counts=true     code "mockserver" -> the fixture guild; "expired" -> 404 Unknown Invite; "limited" -> 429; "groupdm" -> invite with no guild
//   GET /users/@me, /applications/@me         need  Authorization: Bot mock-bot-token-valid-0123456789-abcdefghij   (anything else -> 401)
//   GET /guilds/{id}                          404 Unknown Guild (or 403 Missing Access) while config.inGuild is false
//   GET /guilds/{id}/channels | /roles | /members/{userId}
//   GET /channels/{id}/messages?limit&before  newest first, 100 per page; per-channel rate limit headers; 429 with retry_after;
//                                             content is "" for every message that does not mention the bot while config.intent is false;
//                                             the #staff-chat channel answers 403 Missing Access
// Control (not part of Discord):
//   POST /__config {intent, inGuild, notInGuildStatus, inject429, phase}   GET /__truth (ground truth for assertions)   GET /__stats   POST /__reset
// The fixture: 3 readable text channels (#general, #trading, #bug-reports) + a private #staff-chat + a voice channel, about 400 messages by 40
// humans (3 staff, 1 loud poster with 60 messages, an 8-account raid burst, 3 decoy newcomers, 2 who left the server) and 2 bots.
// phase 1 and phase 2 have different message mixes (the egg dupe improves, trade scams get worse) for the trend test.
import http from 'node:http'

const port = Number(process.env.MOCK_PORT ?? 5198)
export const VALID_TOKEN = 'mock-bot-token-valid-0123456789-abcdefghij'
const EPOCH = 1420070400000n
const GUILD = '700000000000000001'
const BOT_ID = '900000000000000001'
const APP_ID = '800000000000000001'
const OWNER_ID = '600000000000000001'
const NOW = Date.now()
const DAY = 86_400_000

const snow = (ts, n = 0) => String(((BigInt(Math.floor(ts)) - EPOCH) << 22n) | BigInt(n & 0x3fffff))

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---- text ---- */
const T = {
  dupe: {
    channel: 'bug-reports',
    neg: [
      'the egg dupe is still eating my rewards',
      'lost three golden eggs to the dupe bug again, this is not ok',
      'dupe bug ruined the economy and nobody is fixing it',
      'every time I hatch an egg the duplicate glitch removes my reward',
      'so tired of the egg dupe, I am thinking of quitting',
      'egg duplication glitch wiped my best pet, please fix it',
      'dupers are everywhere and the golden egg dupe makes trading worthless',
      'I opened a ticket about the dupe bug a week ago and heard nothing, honestly disappointed with how the devs handle this, I put real time into my base',
    ],
    pos: ['the dupe fix worked for me, hatched twice with no loss', 'thanks for patching the egg duplication, my rewards are safe now', 'no more egg dupe on my account, great fix'],
    neu: ['does the egg dupe patch go live today or tomorrow?', 'is the golden egg dupe being looked at by the devs?'],
    mix: ['dupe fix helped a bit but I still lose some rewards sometimes', 'the egg dupe is mostly gone but the patch broke my hatch animation'],
  },
  scams: {
    channel: 'trading',
    neg: [
      'got scammed in trading, they swapped the pet at the last second',
      'trade scams are out of control and the report button does nothing',
      'another scammer in the trading hub, please add a trade confirm screen',
      'lost my rare t-rex to a fake trade offer, this game needs scam protection',
      'scammers keep tricking people in trades, so annoying',
    ],
    pos: ['the new trade confirmation screen is great, no more scams for me', 'trading feels so much safer after the scam protection update'],
    neu: ['how do I report a scammer in the trading hub?', 'what is a fair trade for a golden t-rex egg?'],
    mix: ['trade confirm is good but it is slow, wish there was a skip for friends'],
  },
  update: {
    channel: 'general',
    neg: ['t-rex egg is way too expensive, this update is a cash grab', 'the update made the shop confusing and I hate the new prices'],
    pos: [
      'the new t-rex egg update is amazing, love the animations',
      't-rex egg is so cool, the best update this year',
      'I hatched a t-rex on my first try, this update rocks',
      'love the new egg designs, great job devs',
      'new update is so fun, the treadmill rework feels great',
    ],
    neu: ['when does the t-rex egg leave the shop?', 'is the new update live on mobile yet?'],
    mix: ['t-rex egg looks great but the hatch odds feel terrible'],
  },
  lag: {
    channel: 'bug-reports',
    neg: ['server lag is unplayable, my treadmill keeps rubber banding', 'constant lag spikes when I steal eggs, please fix the servers', 'game keeps crashing on mobile after the update, so frustrating'],
    pos: ['lag is way better since yesterday, smooth hatching now'],
    neu: ['is anyone else seeing lag in the european servers right now?'],
    mix: [],
  },
  grind: {
    channel: 'general',
    neg: ['the treadmill speed grind is brutal without gamepasses'],
    pos: ['treadmill training is relaxing and the speed gain feels good', 'speed upgrades feel rewarding when you grind with friends'],
    neu: [],
    mix: ['treadmill grind is slow but fun with friends', 'speed upgrades take forever, but I like the progress'],
  },
}
const OFF = ['gm everyone', 'lol', 'anyone up for movie night later?', 'happy friday all', 'who watched the match last night', 'brb dinner', 'hi everyone', 'thanks!', 'haha same', 'good morning']
const SARCASM = ['oh great, another crash, I just love this game so much', 'wow amazing, lost my pet again, best game ever', 'sure, trading is totally safe now, nothing could go wrong']
const EMOJI = ['😂😂😂', '🔥🔥', '💀', '😭😭', '👍']
const RAID = ['this game is garbage and dead, everyone leave now', 'game is dead lmao quit while you can', 'this server is trash and the game is a scam', 'worst game ever, do not play it']
const STAFF_TEXT = [
  'we are aware of the egg dupe and a fix is coming soon, thanks for the patience',
  'trade scam reports are being reviewed by the mod team',
  'the update is live, enjoy the new t-rex egg everyone',
  'please keep chat civil, no scamming in the trading hub',
  'we know the dupe bug is awful and we are really sorry about it',
  'reminder: report bugs in the bug-reports channel with steps',
]
const BOT_TEXT = ['Welcome to the server! Read the rules before trading.', 'Daily reminder: trade only in the trading hub.', 'Patch notes for 1.4.2 are posted.']

const FIRST = ['Mira', 'Jax', 'Nova', 'Kito', 'Lena', 'Orin', 'Pax', 'Ruby', 'Sol', 'Tali', 'Uma', 'Vex', 'Wren', 'Yara', 'Zed', 'Arlo', 'Bree', 'Cade', 'Dara', 'Eli', 'Faye', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lux', 'Moe']
const display = (i) => `${FIRST[i % FIRST.length]}${i >= FIRST.length ? i : ''}`

/* ---- build the fixture for a phase ---- */
function build(phase) {
  const r = rng(phase === 1 ? 4242 : 9191)
  const base = NOW - (phase === 2 ? 0 : 12 * 3_600_000)
  const users = new Map()
  const addUser = (id, username, global_name, extra) => {
    const u = { id, username, global_name, bot: false, kind: 'normal', roles: [], joinedAt: null, left: false, count: 0, ...extra }
    users.set(id, u)
    return u
  }
  // staff
  const staff = [
    addUser('610000000000000001', 'modmika', 'Mod Mika', { kind: 'staff', roles: ['r-mod'], joinedAt: NOW - 600 * DAY }),
    addUser('610000000000000002', 'adminace', 'Admin Ace', { kind: 'staff', roles: ['r-admin'], joinedAt: NOW - 700 * DAY }),
    addUser('610000000000000003', 'helperhal', 'Helper Hal', { kind: 'staff', roles: ['r-mod', 'r-member'], joinedAt: NOW - 400 * DAY }),
  ]
  addUser(OWNER_ID, 'ownerorla', 'Owner Orla', { kind: 'staff', roles: ['r-admin'], joinedAt: NOW - 900 * DAY })
  // loud poster
  const loud = addUser(snow(NOW - 300 * DAY, 11), 'loudlarry', 'Loud Larry', { kind: 'loud', roles: ['r-member'], joinedAt: NOW - 280 * DAY })
  // regular members
  const normals = []
  for (let i = 0; i < 26; i++) {
    const created = NOW - (40 + Math.floor(r() * 800)) * DAY
    const u = addUser(snow(created, 100 + i), `${display(i).toLowerCase()}_${i}`, display(i), { roles: ['r-member'], joinedAt: created + Math.floor(r() * 30) * DAY })
    normals.push(u)
  }
  // decoy newcomers: new accounts that join and post hours later (not a raid)
  const decoys = []
  for (let i = 0; i < 3; i++) {
    const created = NOW - 3 * DAY - i * 7 * 3_600_000
    decoys.push(addUser(snow(created, 300 + i), `newbie${i}`, `Newbie ${i}`, { kind: 'decoy', roles: ['r-member'], joinedAt: created + 10 * 60_000 }))
  }
  // raid: 8 accounts created within 25 minutes, posting within 6 minutes of joining
  const raidStart = base - 2 * DAY
  const raiders = []
  for (let i = 0; i < 8; i++) {
    const created = raidStart - 3 * DAY + i * 3 * 60_000
    raiders.push(addUser(snow(created, 500 + i), `raider${i}`, `raider${i}`, { kind: 'raid', roles: [], joinedAt: raidStart + i * 40_000 }))
  }
  // two people who posted and then left
  const gone = [0, 1].map((i) => addUser(snow(NOW - 200 * DAY, 700 + i), `gone${i}`, `Gone ${i}`, { kind: 'left', left: true }))
  const bots = [
    { id: '910000000000000001', username: 'EggHelper', global_name: null, bot: true },
    { id: '910000000000000002', username: 'UpdateFeed', global_name: null, bot: true, webhook: true },
  ]

  // per-phase mood: probability a message on the topic is negative / positive / mixed / neutral
  const mood = phase === 1
    ? { dupe: [0.8, 0.04, 0.06, 0.1], scams: [0.35, 0.3, 0.1, 0.25], update: [0.1, 0.65, 0.1, 0.15], lag: [0.6, 0.1, 0, 0.3], grind: [0.15, 0.3, 0.4, 0.15] }
    : { dupe: [0.25, 0.4, 0.15, 0.2], scams: [0.85, 0.03, 0.05, 0.07], update: [0.1, 0.65, 0.1, 0.15], lag: [0.55, 0.15, 0, 0.3], grind: [0.15, 0.3, 0.4, 0.15] }
  const pick = (arr) => arr[Math.floor(r() * arr.length)]
  const msgs = []
  const mention = (u) => `<@!${u.id}>`
  let seq = 0
  const push = (channel, author, content, ts, extra = {}) => {
    seq++
    if (!extra.private) author.count = (author.count ?? 0) + 1
    msgs.push({ channel, authorId: author.id, content, ts, seq, mentions: extra.mentions ?? [], webhook: Boolean(extra.webhook), type: extra.type ?? 0 })
  }
  const span = 5.5 * DAY
  const when = () => base - r() * span
  const topicMessage = (topicKey, cls) => {
    const t = T[topicKey]
    const [n, p, m] = mood[topicKey]
    const x = r()
    const kind = x < n ? 'neg' : x < n + p ? 'pos' : x < n + p + m ? 'mix' : 'neu'
    const arr = t[kind].length ? t[kind] : t.neu.length ? t.neu : t.neg
    void cls
    return { text: pick(arr), channel: t.channel }
  }
  const topicKeys = Object.keys(T)
  for (const [ui, u] of normals.entries()) {
    const n = 7 + Math.floor(r() * 10)
    const fav = [topicKeys[ui % 5], topicKeys[(ui * 3 + 1) % 5]]
    for (let k = 0; k < n; k++) {
      const x = r()
      const ts = when()
      if (x < 0.62) {
        const { text, channel } = topicMessage(pick(fav), u)
        push(channel, u, text, ts)
      } else if (x < 0.74) push('general', u, pick(OFF), ts)
      else if (x < 0.8) push(pick(['general', 'trading']), u, pick(SARCASM), ts)
      else if (x < 0.86) push('general', u, pick(EMOJI), ts)
      else if (x < 0.93) push('general', u, '', ts) // image only
      else {
        const other = pick(normals.filter((o) => o !== u))
        push('bug-reports', u, `${mention(other)} same here, ${pick(T.dupe.neg)}`, ts, { mentions: [other.id] })
      }
    }
  }
  for (let k = 0; k < 60; k++) push('bug-reports', loud, `${pick(T.dupe.neg)}${k % 3 === 0 ? ' !!!' : k % 5 === 0 ? ' again' : ''}`, when())
  for (const u of decoys) for (let k = 0; k < 3; k++) push('general', u, pick([...T.update.pos, ...T.dupe.neu]), (u.joinedAt ?? base) + 4 * 3_600_000 + k * 3_600_000)
  for (const u of raiders) for (let k = 0; k < 2; k++) push('general', u, pick(RAID), (u.joinedAt ?? base) + 3 * 60_000 + k * 90_000)
  for (const u of gone) for (let k = 0; k < 3; k++) push('general', u, pick(T.update.pos), when())
  for (const u of staff) for (let k = 0; k < 9; k++) push(pick(['general', 'bug-reports', 'trading']), u, pick(STAFF_TEXT), when())
  users.get(OWNER_ID).count = 0
  for (let k = 0; k < 4; k++) push('general', users.get(OWNER_ID), pick(STAFF_TEXT), when())
  for (let k = 0; k < 12; k++) push('general', { id: bots[0].id, count: 0 }, pick(BOT_TEXT), when())
  for (let k = 0; k < 5; k++) push('general', { id: bots[1].id, count: 0 }, pick(BOT_TEXT), when(), { webhook: true })
  // messages in a channel the bot cannot view (it still lists the channel, with a last_message_id)
  for (let k = 0; k < 3; k++) push('staff-chat', staff[k], pick(STAFF_TEXT), when(), { private: true })
  // a few messages that mention the bot (readable even when the intent is off)
  for (let k = 0; k < 3; k++) push('general', pick(normals), `<@${BOT_ID}> what is the drop rate for the t-rex egg?`, when(), { mentions: [BOT_ID] })

  // channel layout and ids
  const channels = [
    { id: '710000000000000001', name: 'general', type: 0, private: false },
    { id: '710000000000000002', name: 'trading', type: 0, private: false },
    { id: '710000000000000003', name: 'bug-reports', type: 0, private: false },
    { id: '710000000000000004', name: 'staff-chat', type: 0, private: true },
    { id: '710000000000000005', name: 'Voice Lounge', type: 2, private: false },
  ]
  const byName = Object.fromEntries(channels.map((c) => [c.name, c]))
  const out = new Map(channels.map((c) => [c.id, []]))
  msgs.sort((a, b) => a.ts - b.ts || a.seq - b.seq)
  const userOf = (id) => users.get(id) ?? bots.find((b) => b.id === id)
  msgs.forEach((m, i) => {
    const ch = byName[m.channel]
    const author = userOf(m.authorId)
    out.get(ch.id).push({
      id: snow(m.ts, i),
      channel_id: ch.id,
      type: m.type,
      content: m.content,
      timestamp: new Date(m.ts).toISOString(),
      author: { id: author.id, username: author.username, global_name: author.global_name ?? null, bot: Boolean(author.bot) },
      mentions: m.mentions.map((id) => {
        const mu = id === BOT_ID ? { id, username: 'DaemonBot', global_name: null, bot: true } : users.get(id)
        return { id: mu.id, username: mu.username, global_name: mu.global_name ?? null, bot: Boolean(mu.bot) }
      }),
      ...(m.webhook ? { webhook_id: '920000000000000001' } : {}),
    })
  })
  for (const list of out.values()) list.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)) // newest first
  // a private channel with a few messages the bot may not see
  return { users, bots, channels, messages: out, total: msgs.length }
}

/* ---- state ---- */
let cfg
let fixture
let stats
let limiter
const reset = () => {
  cfg = { intent: true, inGuild: true, notInGuildStatus: 404, inject429: 0, phase: 1 }
  fixture = build(1)
  stats = { requests: 0, byRoute: {}, rateLimited: 0, unauthorized: 0, authHeaders: [], paths: [] }
  limiter = new Map()
}
reset()

const json = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers })
  res.end(text)
}
const err = (res, status, message, code = 0, headers) => json(res, status, { message, code }, headers)
const roles = () => [
  { id: GUILD, name: '@everyone', permissions: '1071698660929' },
  { id: 'r-member', name: 'Member', permissions: '66560' },
  { id: 'r-mod', name: 'Moderator', permissions: String(8192n | 2n | 1024n) },
  { id: 'r-admin', name: 'Admin', permissions: '8' },
]

function messagePage(channel, url, res) {
  // per-channel limit: 5 requests per second
  const now = Date.now()
  const w = limiter.get(channel.id) ?? { start: now, n: 0 }
  if (now - w.start >= 1000) {
    w.start = now
    w.n = 0
  }
  w.n++
  limiter.set(channel.id, w)
  const headers = { 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': String(Math.max(0, 5 - w.n)), 'x-ratelimit-reset-after': String(((1000 - (now - w.start)) / 1000).toFixed(3)), 'x-ratelimit-bucket': `bucket-${channel.id}` }
  if (cfg.inject429 > 0 || w.n > 5) {
    if (cfg.inject429 > 0) cfg.inject429--
    stats.rateLimited++
    return json(res, 429, { message: 'You are being rate limited.', retry_after: 0.3, global: false }, { ...headers, 'retry-after': '1', 'x-ratelimit-scope': 'user' })
  }
  if (channel.private) return err(res, 403, 'Missing Access', 50001, headers)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
  const before = url.searchParams.get('before')
  let list = fixture.messages.get(channel.id) ?? []
  if (before) list = list.filter((m) => BigInt(m.id) < BigInt(before))
  const page = list.slice(0, limit).map((m) => {
    const mentionsBot = m.mentions.some((u) => u.id === BOT_ID)
    return cfg.intent || mentionsBot ? m : { ...m, content: '' }
  })
  return json(res, 200, page, headers)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const p = url.pathname.replace(/^\/api\/v\d+/, '').replace(/\/+$/, '')
  const method = req.method ?? 'GET'
  stats.requests++
  const route = p.replace(/\d{6,}/g, ':id')
  stats.byRoute[`${method} ${route}`] = (stats.byRoute[`${method} ${route}`] ?? 0) + 1
  stats.paths.push(`${method} ${p}`)

  if (p.startsWith('/cdn/')) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#2563eb"/><text x="64" y="84" font-size="64" text-anchor="middle" fill="#f3f4f6" font-family="Arial">E</text></svg>`
    res.writeHead(200, { 'content-type': 'image/svg+xml' })
    return res.end(svg)
  }
  if (p === '/__config' && method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const patch = JSON.parse(body || '{}')
      Object.assign(cfg, patch)
      if (patch.phase) fixture = build(patch.phase)
      json(res, 200, { ok: true, cfg })
    })
    return
  }
  if (p === '/__reset') {
    reset()
    return json(res, 200, { ok: true })
  }
  if (p === '/__stats') return json(res, 200, { ...stats, cfg, total: fixture.total })
  if (p === '/__truth') {
    const humans = [...fixture.users.values()].map((u) => ({ id: u.id, name: u.global_name, kind: u.kind, messages: u.count, left: u.left }))
    return json(res, 200, { validBotCredential: VALID_TOKEN, phase: cfg.phase, guildId: GUILD, botId: BOT_ID, applicationId: APP_ID, humans, bots: fixture.bots.map((b) => b.id), total: fixture.total, channels: fixture.channels.map((c) => ({ id: c.id, name: c.name, messages: (fixture.messages.get(c.id) ?? []).length })) })
  }

  // public invite lookup (no auth)
  let m = /^\/invites\/([^/]+)$/.exec(p)
  if (m && method === 'GET') {
    const code = decodeURIComponent(m[1])
    if (code === 'expired' || code === 'deleted') return err(res, 404, 'Unknown Invite', 10006)
    if (code === 'limited') return json(res, 429, { message: 'You are being rate limited.', retry_after: 7.5, global: false }, { 'retry-after': '8' })
    if (code === 'groupdm') return json(res, 200, { type: 1, code, channel: { id: '1', type: 3 } })
    if (code !== 'mockserver') return err(res, 404, 'Unknown Invite', 10006)
    return json(res, 200, {
      type: 0,
      code,
      expires_at: null,
      guild: { id: GUILD, name: 'Steal an Egg Hangout', description: 'The unofficial home of egg thieves, traders and T-Rex hatchers. Be kind, no scamming.', icon: 'mockicon', banner: 'mockbanner', features: ['COMMUNITY', 'NEWS', 'DISCOVERABLE'] },
      channel: { id: fixture.channels[0].id, name: 'general', type: 0 },
      approximate_member_count: 18420,
      approximate_presence_count: 3105,
    })
  }

  // everything else needs the bot token
  const auth = req.headers.authorization ?? ''
  stats.authHeaders.push(auth ? auth.split(' ')[0] : '')
  if (auth !== `Bot ${VALID_TOKEN}`) {
    stats.unauthorized++
    return err(res, 401, '401: Unauthorized', 0)
  }
  if (p === '/users/@me') return json(res, 200, { id: BOT_ID, username: 'DaemonBot', discriminator: '0', bot: true })
  if (p === '/applications/@me') return json(res, 200, { id: APP_ID, name: 'DaemonBot' })
  m = /^\/guilds\/(\d+)(?:\/(channels|roles|members\/(\d+)))?$/.exec(p)
  if (m) {
    const [, gid, sub, uid] = m
    if (gid !== GUILD || !cfg.inGuild) return cfg.notInGuildStatus === 403 ? err(res, 403, 'Missing Access', 50001) : err(res, 404, 'Unknown Guild', 10004)
    if (!sub) return json(res, 200, { id: GUILD, name: 'Steal an Egg Hangout', owner_id: OWNER_ID })
    if (sub === 'channels') return json(res, 200, fixture.channels.map((c) => ({ id: c.id, type: c.type, name: c.name, last_message_id: (fixture.messages.get(c.id) ?? [])[0]?.id ?? null })))
    if (sub === 'roles') return json(res, 200, roles())
    const u = fixture.users.get(uid)
    if (!u || u.left) return err(res, 404, 'Unknown Member', 10007)
    return json(res, 200, { roles: u.roles, joined_at: new Date(u.joinedAt ?? NOW - 100 * DAY).toISOString(), nick: null, user: { id: u.id, username: u.username } })
  }
  m = /^\/channels\/(\d+)\/messages$/.exec(p)
  if (m) {
    const ch = fixture.channels.find((c) => c.id === m[1])
    if (!ch) return err(res, 404, 'Unknown Channel', 10003)
    return messagePage(ch, url, res)
  }
  return err(res, 404, '404: Not Found', 0)
})

server.listen(port, '127.0.0.1', () => console.log(`mock-discord listening on http://127.0.0.1:${port} (${fixture.total} messages, ${fixture.users.size} humans)`))
