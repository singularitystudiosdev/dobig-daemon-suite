// Discord Daemon, end to end against server/test/mock-discord.mjs with the REAL analysis LLM (OpenRouter), plus one REAL public invite.
// Run:  OPENROUTER_API_KEY="$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null)" node server/test/discord.mjs
// The mock Discord API is started here on DISCORD_TEST_PORT (default 5198) unless something already answers there.
// The mock's accepted bot credential is read from the mock at run time (GET /__truth), never written in this file.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DISCORD_TEST_PORT ?? 5198)
const MOCK = `http://127.0.0.1:${PORT}`
const REAL_API = 'https://discord.com/api/v10'
process.env.DISCORD_API_BASE = MOCK
process.env.DISCORD_CDN_BASE = `${MOCK}/cdn`

const { tool } = await import('../tools/discord.ts')
const { RunError } = await import('../tools/types.ts')
const { createLlm, DEFAULT_ANALYSIS_MODEL } = await import('../llm.ts')

const fails = []
const expect = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!cond) fails.push(name)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const up = () => fetch(`${MOCK}/__stats`).then(() => true, () => false)
const mock = (p, init) => fetch(MOCK + p, init).then((r) => r.json())
const config = (patch) => mock('/__config', { method: 'POST', body: JSON.stringify(patch) })

/* ---- start the mock ---- */
let child = null
if (!(await up())) {
  child = spawn(process.execPath, [path.join(here, 'mock-discord.mjs')], { env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: 'ignore' })
  for (let i = 0; i < 50 && !(await up()); i++) await sleep(100)
}
const stop = () => child?.kill()
process.on('exit', stop)
await mock('/__reset', { method: 'POST' })
const truth0 = await mock('/__truth')
const GOOD = truth0.validBotCredential
const WRONG = `${GOOD}-wrong`
const mockAuthed = (p) => fetch(MOCK + p, { headers: { authorization: `Bot ${GOOD}` } }).then((r) => r.json())

/* ---- fakes for the run engine ---- */
function secretsStore(initial) {
  const v = new Map(initial ? [['discord-bot-token', initial]] : [])
  return { get: (n) => v.get(n) ?? null, has: (n) => v.has(n), set: (n, x) => void v.set(n, x), remove: (n) => void v.delete(n) }
}
function memoryStore() {
  const map = new Map()
  return { map, get: (k) => map.get(k), set: (k, x) => void map.set(k, JSON.parse(JSON.stringify(x))) }
}
const guildId = truth0.guildId
const target = { kind: 'discord-server', invite: 'mockserver', guildId, name: 'Steal an Egg Hangout' }
const key = (process.env.OPENROUTER_API_KEY ?? '').trim()
const realLlm = createLlm({ key, baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL })

async function run({ token = GOOD, llm = realLlm, memory = memoryStore(), previous = [], abort } = {}) {
  const out = { steps: [], summary: null, findings: [], error: null }
  const ac = new AbortController()
  abort?.(ac, out)
  const ctx = {
    tool: 'discord-daemon', target, trigger: 'user', runId: 'r1', daemonId: 'd1', now: new Date(), signal: ac.signal,
    step: (id, label, state, detail) => out.steps.push({ id, label, state, detail }),
    summary: (s) => (out.summary = s),
    finding: (f) => out.findings.push(f),
    llm, secrets: secretsStore(token), memory, previous,
  }
  try {
    await tool.analyze(ctx)
  } catch (err) {
    out.error = err
  }
  return out
}

/* ---- route harness ---- */
async function route(name, { query = '', body, secrets } = {}) {
  const result = { status: 0, data: null }
  const ctx = {
    url: new URL(`http://localhost${name.split(' ')[1]}${query}`), req: {}, res: {},
    body: async () => body,
    json: (status, data) => ((result.status = status), (result.data = data)),
    secrets,
  }
  await tool.routes[name](ctx)
  return result
}

/* =============== 1. resolve (against the mock) =============== */
console.log('\n== resolve ==')
{
  const forms = ['mockserver', 'https://discord.gg/mockserver', 'discord.gg/mockserver?utm_source=x&utm_medium=y#top', 'https://discord.com/invite/mockserver?event=1', '  https://www.discord.com/invite/mockserver  ']
  for (const f of forms) {
    const r = await route('GET /api/discord/resolve', { query: `?link=${encodeURIComponent(f)}` })
    expect(`resolve accepts ${JSON.stringify(f)}`, r.status === 200 && r.data.ok && r.data.server.guildId === guildId)
  }
  const ok = (await route('GET /api/discord/resolve', { query: '?link=mockserver' })).data.server
  expect('server info: name, description, counts, features, url', ok.name === 'Steal an Egg Hangout' && /egg thieves/.test(ok.description) && ok.members === 18420 && ok.online === 3105 && ok.features.includes('COMMUNITY') && ok.url === 'https://discord.gg/mockserver', `${ok.members} members, ${ok.online} online`)
  expect('icon and banner URLs are built from the hashes', ok.iconUrl === `${MOCK}/cdn/icons/${guildId}/mockicon.png?size=128` && ok.bannerUrl === `${MOCK}/cdn/banners/${guildId}/mockbanner.png?size=1024`, ok.iconUrl)
  for (const bad of ['', 'hello world', 'https://example.com/abc', 'https://discord.gg/', 'a', 'https://discord.com/channels/1/2/3', '<script>']) {
    const r = await route('GET /api/discord/resolve', { query: `?link=${encodeURIComponent(bad)}` })
    expect(`bad link ${JSON.stringify(bad)} -> bad-link`, r.status === 400 && r.data.code === 'bad-link' && r.data.message.length > 20)
  }
  const exp = await route('GET /api/discord/resolve', { query: '?link=expired' })
  expect('expired invite -> not-found that says expired and names the fix', exp.data.code === 'not-found' && /expired/.test(exp.data.message) && /permanent invite/.test(exp.data.message), exp.data.message.slice(0, 70))
  const lim = await route('GET /api/discord/resolve', { query: '?link=limited' })
  expect('429 -> rate-limited with retryAfter', lim.data.code === 'rate-limited' && lim.data.retryAfter === 8, JSON.stringify(lim.data))
  const dm = await route('GET /api/discord/resolve', { query: '?link=groupdm' })
  expect('a group-chat invite is not a server', dm.data.code === 'not-found' && /not for a server/.test(dm.data.message))
}

/* =============== 2. token and bot-status routes =============== */
console.log('\n== token and bot-status ==')
{
  const secrets = secretsStore(null)
  const s0 = await route('GET /api/discord/bot-status', { query: `?guildId=${guildId}`, secrets })
  expect('bot-status with no token', s0.data.tokenSet === false && s0.data.bot === null && s0.data.inGuild === null && s0.data.inviteUrl === null && s0.data.intent === 'unknown', JSON.stringify(s0.data))
  secrets.set('discord-bot-token', WRONG)
  const s1 = await route('GET /api/discord/bot-status', { query: `?guildId=${guildId}`, secrets })
  secrets.remove('discord-bot-token')
  expect('bot-status with a rejected token says tokenValid false', s1.data.tokenSet === true && s1.data.tokenValid === false && s1.data.bot === null, JSON.stringify(s1.data))
  const empty = await route('POST /api/discord/token', { body: { token: '  ' }, secrets })
  expect('empty token -> 400 with the help text', empty.status === 400 && /Reset Token/.test(empty.data.message))
  const bad = await route('POST /api/discord/token', { body: { token: WRONG }, secrets })
  expect('wrong token -> 401, says it is wrong and where to copy it', bad.status === 401 && /wrong/.test(bad.data.message) && /Developer Portal/.test(bad.data.message) && /Bot/.test(bad.data.message), bad.data.message.slice(0, 60))
  expect('wrong token is not stored and not echoed', !secrets.has('discord-bot-token') && !JSON.stringify(bad).includes(WRONG))
  const good = await route('POST /api/discord/token', { body: { token: `Bot ${GOOD}` }, secrets })
  expect('valid token -> ok with bot and applicationId', good.status === 200 && good.data.ok && good.data.bot.username === 'DaemonBot' && good.data.applicationId === truth0.applicationId, JSON.stringify(good.data))
  expect('valid token stored via secrets.set, never echoed', secrets.get('discord-bot-token') === GOOD && !JSON.stringify(good).includes(GOOD))
  const s2 = await route('GET /api/discord/bot-status', { query: `?guildId=${guildId}`, secrets })
  expect('bot-status: token set, bot, app id, in guild', s2.data.tokenSet && s2.data.bot.id === truth0.botId && s2.data.applicationId === truth0.applicationId && s2.data.inGuild === true, JSON.stringify(s2.data))
  expect('invite URL form and permissions 66560', s2.data.inviteUrl === `https://discord.com/oauth2/authorize?client_id=${truth0.applicationId}&scope=bot&permissions=66560`, s2.data.inviteUrl)
  expect('bot-status never contains the token', !JSON.stringify(s2).includes(GOOD))
  await config({ inGuild: false })
  const s3 = await route('GET /api/discord/bot-status', { query: `?guildId=${guildId}`, secrets })
  expect('bot not in the server -> inGuild false', s3.data.inGuild === false && s3.data.inviteUrl !== null)
  await config({ inGuild: true })
  const del = await route('DELETE /api/discord/token', { secrets })
  expect('DELETE token removes it', del.data.ok === true && !secrets.has('discord-bot-token'))
}

/* =============== 3. every error path (no LLM spend) =============== */
console.log('\n== error paths ==')
const leakCheck = []
{
  const noLlm = { available: true, model: 'stub', json: async () => { throw new Error('the LLM must not be called on an error path') } }
  const a = await run({ token: null, llm: noLlm })
  expect('no token -> no-discord-token + add-discord-token action', a.error instanceof RunError && a.error.code === 'no-discord-token' && a.error.action?.kind === 'add-discord-token', a.error?.message.slice(0, 70))
  const b = await run({ token: WRONG, llm: noLlm })
  expect('rejected token -> no-discord-token + add-discord-token action', b.error?.code === 'no-discord-token' && b.error.action?.kind === 'add-discord-token' && !b.error.message.includes(WRONG), b.error?.message.slice(0, 70))
  await config({ inGuild: false, notInGuildStatus: 404 })
  const c = await run({ llm: noLlm })
  expect('bot not in guild (404) -> discord-bot-missing + open-url with the OAuth invite', c.error?.code === 'discord-bot-missing' && c.error.action?.kind === 'open-url' && c.error.action.url === `https://discord.com/oauth2/authorize?client_id=${truth0.applicationId}&scope=bot&permissions=66560` && /Add the bot to Steal an Egg Hangout/.test(c.error.message), c.error?.message.slice(0, 70))
  expect('the action label names the server', /Steal an Egg Hangout/.test(c.error?.action?.label ?? ''))
  await config({ notInGuildStatus: 403 })
  const c2 = await run({ llm: noLlm })
  expect('bot not in guild (403) -> discord-bot-missing too', c2.error?.code === 'discord-bot-missing')
  await config({ inGuild: true })
  await config({ intent: false })
  const d = await run({ llm: noLlm })
  expect('message content intent off -> discord-intent + open-url to the bot settings', d.error?.code === 'discord-intent' && d.error.action?.kind === 'open-url' && d.error.action.url === `https://discord.com/developers/applications/${truth0.applicationId}/bot` && /MESSAGE CONTENT INTENT/.test(d.error.message), d.error?.message.slice(0, 70))
  await config({ intent: true })
  leakCheck.push(JSON.stringify([a, b, c, c2, d].map((x) => [x.error?.message, x.error?.action, x.steps])))

  const ctrl = await run({ llm: noLlm, abort: (ac, out) => { const t = setInterval(() => { if (out.steps.some((s) => s.id === 'channels' && s.state === 'done')) { clearInterval(t); ac.abort() } }, 1) } })
  expect('abort mid-run raises aborted', ctrl.error?.code === 'aborted', ctrl.error?.code ?? 'no error')
  const noKey = await run({ llm: createLlm({ key: '', baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL }) })
  expect('no OpenRouter key -> no-llm-key with add-key action', noKey.error?.code === 'no-llm-key' && noKey.error.action?.kind === 'add-key', noKey.error?.message.slice(0, 70))
}

/* =============== 4. rate limits and an unscorable batch (stub LLM) =============== */
console.log('\n== rate limits and failed batches ==')
{
  await mock('/__reset', { method: 'POST' })
  let calls = 0
  const stub = {
    available: true, model: 'stub',
    json: async (req) => {
      calls++
      const items = req.user.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))
      if (items.length < 100) throw new RunError('upstream', 'stub failure') // the short last batch always fails, so it fails twice
      return { costUsd: 0, model: 'stub', data: { items: items.map((m) => ({ i: m.i, sentiment: /dupe|lag|scam/.test(m.text) ? 'negative' : 'neutral', intensity: 2, topic: /dupe/.test(m.text) ? 'egg dupe' : 'general talk', aboutTheGame: /dupe/.test(m.text), lowConfidence: false })) } }
    },
  }
  await config({ inject429: 2 })
  const t0 = Date.now()
  const r = await run({ llm: stub })
  const st = await mock('/__stats')
  expect('run completes through two injected 429s (retry_after honoured)', !r.error && st.rateLimited >= 2, `rateLimited=${st.rateLimited} error=${r.error?.message ?? 'none'} ${Date.now() - t0}ms`)
  expect('a step says it waited for the rate limit', r.steps.some((s) => /Waiting .*rate limit/.test(s.detail ?? '')))
  expect('a batch that failed twice is marked unscored, not guessed (notice + warn step)', r.summary?.notices?.some((n) => /failed twice/.test(n.lead)) && r.steps.some((s) => s.id === 'sentiment' && s.state === 'warn'))
  expect('the failed batch was retried once (full batches once, the short last batch twice)', calls >= 5, `calls=${calls}`)
}

/* =============== 5. the real LLM run on the mock guild, then a second run =============== */
console.log('\n== run 1 (real LLM) ==')
await mock('/__reset', { method: 'POST' })
const truth1 = await mock('/__truth')
const kinds = (k) => truth1.humans.filter((h) => h.kind === k)
const kindOf = new Map(truth1.humans.map((h) => [h.id, h.kind]))
const messageIndex = new Map()
const readable = new Map()
for (const ch of truth1.channels) {
  if (ch.name === 'staff-chat' || ch.name === 'Voice Lounge') continue
  let before
  for (;;) {
    const page = await mockAuthed(`/channels/${ch.id}/messages?limit=100${before ? `&before=${before}` : ''}`)
    if (!Array.isArray(page) || page.length === 0) break
    for (const m of page) {
      messageIndex.set(m.id, { ...m, channelName: ch.name })
      if (m.content.trim() && !m.author.bot && !m.webhook_id && !(m.mentions ?? []).some((u) => u.id === truth1.botId)) readable.set(m.author.id, (readable.get(m.author.id) ?? 0) + 1)
    }
    if (page.length < 100) break
    before = page[page.length - 1].id
  }
}
const COUNTED_KINDS = ['normal', 'loud', 'decoy', 'left']
const expectedCounted = [...readable.keys()].filter((id) => COUNTED_KINDS.includes(kindOf.get(id))).length
const loudId = kinds('loud')[0].id
console.log(`ground truth: ${messageIndex.size} messages in the 3 readable channels, ${expectedCounted} people expected counted, the loud poster wrote ${readable.get(loudId)} readable messages`)

if (!key) {
  console.log('SKIP  no OPENROUTER_API_KEY in the environment: the real-LLM runs were not executed')
  fails.push('real LLM run skipped')
} else {
  const mem = memoryStore()
  const r1 = await run({ memory: mem })
  expect('run 1 finished without error', !r1.error, r1.error?.message)
  const s = Object.fromEntries((r1.summary?.items ?? []).map((i) => [i.label, i.value]))
  console.log('summary:', JSON.stringify(s))
  for (const n of r1.summary?.notes ?? []) console.log('  note:', n)
  for (const n of r1.summary?.notices ?? []) console.log('  notice:', n.lead, n.body)
  expect('summary has the five items, sortLabel and notes', r1.summary.items.length === 5 && r1.summary.sortLabel === 'Strongest negative sentiment first' && r1.summary.notes.some((n) => /each person once/.test(n)) && r1.summary.notes.some((n) => /Staff detection/.test(n)) && r1.summary.notes.some((n) => /^Window: /.test(n)))
  expect('People counted = real distinct humans (loud poster once; bots, staff, raid out)', Number(s['People counted']) === expectedCounted, `${s['People counted']} vs ${expectedCounted}`)
  expect('Excluded = 4 staff + 8 raid + 2 bots', Number(s['Excluded: staff, raids, bots']) === 14, s['Excluded: staff, raids, bots'])
  expect('Messages read = every message fetched from the 3 readable channels', Number(s['Messages read'].replace(/,/g, '')) === messageIndex.size, `${s['Messages read']} vs ${messageIndex.size}`)
  expect('Channels read = 3 (private channel skipped with a notice)', s['Channels read'] === '3' && r1.summary.notices.some((n) => /1 channel was skipped/.test(n.lead)))
  expect('raid burst detected from join dates', r1.summary.notes.some((n) => /Raid check: 8 accounts/.test(n)), r1.summary.notes.find((n) => /Raid/.test(n)))
  const F = r1.findings
  expect('findings exist, each topic has >= 3 people', F.length > 0 && F.every((f) => f.detail.people >= 3), `${F.length} findings`)
  expect('ids sent:<slug>, detail kind sentiment, badge matches detail.sentiment', F.every((f) => /^sent:[a-z0-9-]+$/.test(f.id) && f.detail.kind === 'sentiment' && f.badge.label === { 'strongly-negative': 'Strongly negative', negative: 'Negative', mixed: 'Mixed', positive: 'Positive', neutral: 'Neutral' }[f.detail.sentiment]))
  expect('score in [-1,1]; shares are people and sum to people', F.every((f) => f.detail.score >= -1 && f.detail.score <= 1 && Object.values(f.detail.shares).reduce((a, b) => a + b, 0) === f.detail.people))
  expect('people not messages: no topic has more people than were counted; some topic has far more messages than people', F.every((f) => f.detail.people <= expectedCounted) && F.some((f) => f.detail.messages > f.detail.people * 1.5), F.map((f) => `${f.title}:${f.detail.people}p/${f.detail.messages}m`).join(' | '))
  const dupe = F.find((f) => /dupe|dupl/.test(f.title.toLowerCase()))
  expect('egg dupe topic: negative or strongly negative, the loud poster is one person among its people', !!dupe && /negative/.test(dupe.detail.sentiment) && dupe.detail.people < dupe.detail.messages - 30, dupe ? `${dupe.detail.people} people / ${dupe.detail.messages} messages, score ${dupe.detail.score}` : 'none')
  const hidden = new Set([...kinds('staff'), ...kinds('raid')].map((h) => h.name))
  const quotes = F.flatMap((f) => f.detail.quotes.map((q) => ({ f, q })))
  expect('every finding has at least one quote', F.every((f) => f.detail.quotes.length > 0), F.filter((f) => !f.detail.quotes.length).map((f) => f.title).join(','))
  expect('quotes are <= 140 chars, never an @mention, never a link', quotes.every(({ q }) => q.text.length <= 140 && !/<@|@\d{5,}/.test(q.text) && !/https?:\/\//.test(q.text)))
  const urlRe = new RegExp(`^https://discord\\.com/channels/${guildId}/(\\d+)/(\\d+)$`)
  expect('every quote url is a Discord message URL to a real message id whose text matches', quotes.every(({ q }) => { const m = urlRe.exec(q.url); const real = m && messageIndex.get(m[2]); return real && real.channel_id === m[1] && (() => { const full = real.content.replace(/<@!?\d+>/g, '@someone').replace(/\s+/g, ' ').trim(); return full === q.text || (q.text.endsWith('\u2026') && full.startsWith(q.text.slice(0, -1))) })() }), `${quotes.length} quotes`)
  expect('no quote comes from staff, a raid account or a bot', quotes.every(({ q }) => { const real = messageIndex.get(urlRe.exec(q.url)[2]); return !real.author.bot && !hidden.has(q.author) && COUNTED_KINDS.includes(kindOf.get(real.author.id)) }))
  expect('finding url = lead quote url; snippet is the lead quote', F.every((f) => f.url === f.detail.quotes[0].url && f.snippet[0].text.includes(f.detail.quotes[0].text)))
  expect('meta labels People, Messages, Negative share, Trend; first run reads "first run", status New, no trend', F.every((f) => f.meta.map((m) => m.label).join() === 'People,Messages,Negative share,Trend' && f.meta[3].value === 'first run' && f.status.label === 'New' && f.detail.trend === null))
  const tier = (f) => (f.detail.sentiment === 'strongly-negative' ? 0 : f.detail.sentiment === 'negative' ? 1 : f.group === 'shifts' ? 2 : f.detail.sentiment === 'mixed' ? 3 : f.detail.sentiment === 'positive' ? 4 : 5)
  expect('sorted: strongly negative, negative, shifts, mixed, positive, neutral; people desc inside a tier', F.every((f, i) => i === 0 || tier(F[i - 1]) < tier(f) || (tier(F[i - 1]) === tier(f) && F[i - 1].detail.people >= f.detail.people)))
  expect('a Reviewed state chip exists on every row', F.every((f) => f.states?.reviewed?.label === 'Reviewed'))
  const memDump = JSON.stringify([...mem.map.entries()])
  expect('memory holds topic scores only, no message text', [...mem.map.keys()].join() === 'topics' && !quotes.some(({ q }) => memDump.includes(q.text.slice(0, 25))))
  console.log('\n  run 1 findings (title | badge | people/messages | score | negative share | status | lead quote):')
  for (const f of F) console.log(`   ${f.title.padEnd(26)} ${f.badge.label.padEnd(17)} ${String(f.detail.people).padStart(2)}p/${String(f.detail.messages).padStart(3)}m ${String(f.detail.score).padStart(5)} ${f.meta[2].value.padStart(4)} ${f.status.label.padEnd(9)} ${f.snippet[0].text}`)

  const memAfter1 = JSON.parse(JSON.stringify(mem.get('topics')))
  /* ---- run 2: the mood changed; the same daemon memory carries the trend ---- */
  console.log('\n== run 2 (real LLM, changed messages) ==')
  await config({ phase: 2 })
  const r2 = await run({ memory: mem, previous: F })
  expect('run 2 finished without error', !r2.error, r2.error?.message)
  const F2 = r2.findings
  const withTrend = F2.filter((f) => f.detail.trend)
  expect('run 2 has trend deltas equal to score minus previous score', withTrend.length > 0 && withTrend.every((f) => { const prev = memAfter1[f.id.replace(/^sent:/, '')]; return prev && f.detail.trend.previousScore === prev.score && Math.abs(f.detail.trend.delta - (f.detail.score - prev.score)) < 0.011 }), `${withTrend.length} of ${F2.length} findings have a trend`)
  expect('trend text reads like "down 0.31 since last run", "up ..." or "steady (+0.02)"', withTrend.every((f) => /^(down|up) \d\.\d\d since last run$|^steady \([+-]\d\.\d\d\)$/.test(f.meta[3].value)), withTrend.map((f) => f.meta[3].value).join(' | '))
  const big = F2.filter((f) => f.detail.trend && f.detail.trend.delta <= -0.25)
  expect('a topic whose score fell by >= 0.25 is a shift: Worsening chip and a "shifted" notice (trade scams get worse in phase 2)', big.length > 0 && big.every((f) => f.status.label === 'Worsening') && r2.summary.notices.some((n) => /shifted/.test(n.lead)), big.map((f) => `${f.title} ${f.detail.trend.delta}`).join(' | ') || 'no topic fell by 0.25')
  expect('run 2 People counted stays near the truth (bots, staff, raid still out)', Math.abs(Number(r2.summary.items.find((i) => i.label === 'People counted').value) - expectedCounted) <= 6, r2.summary.items.find((i) => i.label === 'People counted').value)
  console.log('  run 2 findings (title | badge | people/messages | score | trend | status):')
  for (const f of F2) console.log(`   ${f.title.padEnd(26)} ${f.badge.label.padEnd(17)} ${String(f.detail.people).padStart(2)}p/${String(f.detail.messages).padStart(3)}m ${String(f.detail.score).padStart(5)} ${f.meta[3].value.padEnd(26)} ${f.status.label}`)
  leakCheck.push(JSON.stringify([r1, r2]))
  console.log(`\n  one detail payload, as the UI receives it:\n${JSON.stringify(F[0].detail, null, 1).slice(0, 1400)}`)
}

/* =============== 6. the token never leaks =============== */
console.log('\n== token never appears ==')
expect('the token and the wrong token never appear in any error, step, summary or finding', !leakCheck.join('\n').includes(GOOD) && !leakCheck.join('\n').includes(WRONG))

/* =============== 7. a REAL public invite =============== */
console.log('\n== real invite (discord.com) ==')
{
  process.env.DISCORD_API_BASE = REAL_API
  process.env.DISCORD_CDN_BASE = 'https://cdn.discordapp.com'
  const real = await route('GET /api/discord/resolve', { query: `?link=${encodeURIComponent('https://discord.gg/discord-developers?utm_source=test')}` })
  console.log(JSON.stringify(real.data, null, 1).slice(0, 900))
  const sv = real.data.server
  expect('real invite resolves: guild id, name, member and online counts', real.status === 200 && real.data.ok && /^\d+$/.test(sv.guildId) && sv.name.length > 0 && sv.members > 1000 && sv.online > 0, `${sv?.name}: ${sv?.members} members, ${sv?.online} online`)
  expect('real icon URL points at the Discord CDN', /^https:\/\/cdn\.discordapp\.com\/icons\/\d+\/[a-z0-9_]+\.png\?size=128$/.test(sv?.iconUrl ?? ''), sv?.iconUrl)
  const gone = await route('GET /api/discord/resolve', { query: '?link=this-code-does-not-exist-zz9' })
  expect('real unknown invite -> not-found (404 from Discord)', gone.data.code === 'not-found', gone.data.message?.slice(0, 80))
}

stop()
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall passed')
process.exit(fails.length ? 1 : 0)
