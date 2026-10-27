// Description Daemon end to end against REAL Roblox and the REAL LLM, plus a mock Open Cloud for the two owner-key paths.
//   OPENROUTER_API_KEY="$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null)" node server/test/description.mjs
// The key is read from the environment only and never printed. Needs network (Roblox public APIs, OpenRouter).
//   DESC_DUMP=path.json  also write every run's real summary + findings (for rendering the view in a throwaway harness)
//   --offline   run only the deterministic lint, diff and guard proofs
// Roblox Open Cloud (analytics + PATCH description) is NOT run against real Roblox: no owner key exists on this machine.
// Those paths are verified against server/test/mock-opencloud.mjs only.
import { createLlm, DEFAULT_ANALYSIS_MODEL } from '../llm.ts'
import { lintDescription, similarityGuard, textOverlap, wordDiff, lineDiffCounts, extractPatterns, struckSegments, DESCRIPTION_LIMIT } from '../tools/description-lint.ts'
import { tool, readCompetitors, compareRank } from '../tools/description.ts'
import { startMockOpenCloud } from './mock-opencloud.mjs'

const offline = process.argv.includes('--offline')
let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const hr = (t) => console.log(`\n=== ${t} ===`)
const KEY = 'mock-key-7f3a9c1e'

/* ---------------------------------------------------------------- a RunContext harness */

function makeCtx({ target, memory, previous = [], secrets = {}, llm, iterationLabel }) {
  const events = { steps: [], summary: null, findings: [] }
  const ac = new AbortController()
  const ctx = {
    tool: 'description-daemon',
    target,
    trigger: 'schedule',
    runId: `test-${iterationLabel}`,
    daemonId: 'test-daemon',
    now: new Date(),
    signal: ac.signal,
    step: (id, label, state, detail) => {
      events.steps.push({ id, label, state, detail })
      if (state !== 'active') console.log(`  [${state}] ${label}${detail ? ': ' + detail : ''}`)
    },
    summary: (s) => (events.summary = s),
    finding: (f) => events.findings.push(f),
    llm,
    secrets: { get: (n) => secrets[n] ?? null, has: (n) => n in secrets },
    memory: { get: (k) => (memory.has(k) ? JSON.parse(JSON.stringify(memory.get(k))) : undefined), set: (k, v) => memory.set(k, JSON.parse(JSON.stringify(v))) },
    previous,
  }
  return { ctx, events }
}

const draftText = (f) => f.detail.text.map((s) => s.text).join('')
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function printRun(events) {
  const s = events.summary
  console.log('\n  SUMMARY  sort: ' + s.sortLabel)
  for (const i of s.items) console.log(`    ${i.label}: ${i.value}`)
  for (const n of s.notices ?? []) console.log(`    notice [${n.lead}] ${n.body}`)
  for (const n of s.notes ?? []) console.log(`    note: ${n}`)
  for (const f of events.findings) {
    const d = f.detail
    console.log(`\n  ${f.id}  [${f.badge.label}]  ${f.title}   chars ${d.chars}, lint ${d.lintScore.passed} of ${d.lintScore.total}, unverified ${d.unverifiedClaims.length}, guard tries ${d.guard.attempts}`)
    console.log(`    what changed: ${d.whatChanged}`)
    console.log('    ---- draft ----')
    for (const l of draftText(f).split('\n')) console.log('    | ' + l)
    console.log('    ---------------')
    for (const c of d.lint) console.log(`    ${c.passed ? 'pass' : 'FAIL'}  ${c.title}: ${c.reason}${c.flags.length ? ' flags=' + c.flags.map((x) => `[${x.start},${x.end}) ${JSON.stringify(x.text.slice(0, 40))}`).join(' ') : ''}`)
    for (const c of d.unverifiedClaims) console.log(`    unverified claim: ${c}`)
  }
}

/* ---------------------------------------------------------------- 1. lint: planted bad text (deterministic) */

hr('1. Lint catches planted bad text')
{
  const planted = 'A fishing adventure where you cast a line and catch rare fish with friends.\n\nFREE ROBUX giveaway every 10 min!!!'
  const r = lintDescription(planted)
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]))
  check('giveaway check fails on "FREE ROBUX giveaway every 10 min!!!"', !byId.giveaway.passed, byId.giveaway.flags.map((f) => JSON.stringify(f.text)).join(' '))
  check('punctuation check fails on "!!!"', !byId.punctuation.passed, byId.punctuation.flags.map((f) => JSON.stringify(f.text)).join(' '))
  check('planted draft is blocked', r.blocked === true)
  check('flag offsets slice back to the flagged text', r.checks.every((c) => c.flags.every((f) => planted.slice(f.start, f.end) === f.text)))
  check('struck segments rebuild the text and mark the spans', r.segments.map((s) => s.text).join('') === planted && r.segments.some((s) => s.struck && /FREE ROBUX/i.test(s.text)))
  console.log(`  lint score ${r.passed} of ${r.total}; struck: ${r.segments.filter((s) => s.struck).map((s) => JSON.stringify(s.text)).join(', ')}`)

  const stuffed = 'Catch fish and sell them at the dock.\nfishing, fish, rod, boat, sea, ocean, lake, river, bait, hook, reel, sail\nTags (ignore): fishing roblox'
  const r2 = lintDescription(stuffed)
  const st = r2.checks.find((c) => c.id === 'stuffing')
  check('comma-stuffed keyword line and tag line fail the stuffing check', !st.passed && st.flags.length >= 2, st.flags.map((f) => JSON.stringify(f.text.slice(0, 34))).join(' | '))

  const repeated = 'Play our fun obby game. Obby obby obby obby obby obby obby with checkpoints and a tower.'
  check('repeated-token stuffing fails', !lintDescription(repeated).checks.find((c) => c.id === 'stuffing').passed)

  const shout = 'JOIN NOW AND PLAY THE BEST FISHING GAME EVER MADE, CATCH EVERY FISH TODAY with your friends in this world.'
  check('ALL CAPS shouting fails', !lintDescription(shout).checks.find((c) => c.id === 'caps').passed)

  const long = 'Catch fish. ' + 'x'.repeat(150) + ' ' + 'word '.repeat(60)
  check('over-long line fails', !lintDescription(long).checks.find((c) => c.id === 'long-lines').passed)

  const over = 'Catch fish in a big open world with friends. ' + 'a'.repeat(DESCRIPTION_LIMIT)
  const lo = lintDescription(over).checks.find((c) => c.id === 'limit')
  check(`over ${DESCRIPTION_LIMIT} characters fails, overflow flagged`, !lo.passed && lo.flags[0].start === DESCRIPTION_LIMIT && lo.flags[0].end === over.length)

  check('first-line check fails on a greeting opener', !lintDescription('Welcome to my game!\n\nCatch fish with friends all day long in the lake.').checks.find((c) => c.id === 'first-line').passed)
  check('emoji run fails', !lintDescription('Great fishing game for friends to explore the lake 🐒🐬🐊🌍🍀').checks.find((c) => c.id === 'emoji').passed)

  const good = 'Cast a line, catch rare fish and upgrade your rod in a calm open world.\n\nHow to play:\n- Hold to cast\n- Reel in the catch\n- Sell fish to buy better gear'
  const rg = lintDescription(good)
  check('a clean description passes all 8 checks', rg.passed === 8 && !rg.blocked, `${rg.passed} of ${rg.total}`)
  check('Robux mentioned as a spend (not a reward) is not flagged', lintDescription('Spend Robux on optional boosts to speed up fishing in this relaxed fishing game.').checks.find((c) => c.id === 'giveaway').passed)
  check('lint is deterministic', JSON.stringify(lintDescription(planted)) === JSON.stringify(lintDescription(planted)))
  check('struckSegments with no flags is one plain run', struckSegments('abc', []).length === 1)
}

/* ---------------------------------------------------------------- 2. diff + line counts */

hr('2. Word diff and change counts')
{
  const parts = wordDiff('Catch rare fish\nSell them\nBuy a boat', 'Catch rare fish quickly\nSell them\nBuy a rod')
  check('word diff marks added and removed words', parts.some((p) => p.kind === 'added' && /quickly/.test(p.text)) && parts.some((p) => p.kind === 'removed' && /boat/.test(p.text)) && parts.some((p) => p.kind === 'added' && /rod/.test(p.text)))
  check('same+added text rebuilds the draft', parts.filter((p) => p.kind !== 'removed').map((p) => p.text).join('') === 'Catch rare fish quickly\nSell them\nBuy a rod')
  const t = wordDiff('Steal eggs from pets and hatch them', 'Hatch eggs from players and steal pets')
  check('tidy diff: a change block lists removed text before added text, and both sides rebuild', t.filter((p) => p.kind !== 'added').map((p) => p.text).join('').trim() === 'Steal eggs from pets and hatch them' && t.filter((p) => p.kind !== 'removed').map((p) => p.text).join('').trim() === 'Hatch eggs from players and steal pets' && t.every((p, i) => !(p.kind === 'removed' && t[i - 1]?.kind === 'added')))
  const c = lineDiffCounts('a\nb\nc\nd', 'a\nx\ny\nz\nd')
  check('line diff counts +3 -2', c.added === 3 && c.removed === 2, JSON.stringify(c))
}

if (offline) {
  console.log(`\n${pass} passed, ${fail} failed (offline)`)
  process.exit(fail ? 1 : 0)
}

/* ---------------------------------------------------------------- 3. similarity guard against REAL competitors */

const orKey = (process.env.OPENROUTER_API_KEY ?? '').trim()
if (!orKey) {
  console.error('OPENROUTER_API_KEY is not set: pass it inline from the keychain (see the header of this file).')
  process.exit(2)
}
const llm = createLlm({ key: orKey, baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL })
const TARGETS = {
  egg: { kind: 'roblox-game', universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' },
  fisch: { kind: 'roblox-game', universeId: 5750914919, placeId: 16732694052, name: 'Fisch' },
}

hr('3. Similarity guard against real competitor descriptions')
{
  const ac = new AbortController()
  const comps = await readCompetitors(['steal eggs pets', 'egg hatching simulator', 'collect rare pets'], TARGETS.egg.universeId, ac.signal, (q, n) => console.log(`  omni-search "${q}": ${n} games`))
  console.log(`  read ${comps.length} real competitor descriptions: ${comps.map((c) => c.name).join(' | ')}`)
  check('read at least 5 real competitor descriptions', comps.length >= 5)
  check('this universe is excluded', comps.every((c) => c.universeId !== TARGETS.egg.universeId))
  check('every competitor has a real roblox.com/games link and a non-empty description', comps.every((c) => /^https:\/\/www\.roblox\.com\/games\/\d+$/.test(c.url) && c.description.length >= 20))
  check('no competitor description exceeds the 1000 character limit (limit sanity)', comps.every((c) => c.description.length <= DESCRIPTION_LIMIT), `longest ${Math.max(...comps.map((c) => c.description.length))}`)
  const pool = comps.map((c) => ({ name: c.name, description: c.description }))
  const src = comps.find((c) => normWordsCount(c.description) >= 12) ?? comps[0]
  const copied = src.description.split(/\s+/).slice(0, 10).join(' ')
  const plantedCopy = `Brand new intro line about eggs. ${copied} and then more original words here.`
  const hits = similarityGuard(plantedCopy, pool, 'Live description text that has nothing in common with it at all.')
  check('guard rejects a draft that copies a competitor phrase (7-word shingle)', hits.length > 0 && hits.some((h) => h.competitor === src.name), `${hits.length} shared phrases, e.g. ${JSON.stringify(hits[0]?.phrase)} from ${hits[0]?.competitor}`)
  check('guard passes an original draft', similarityGuard('Hatch strange creatures, protect your nest and build the largest collection on your island.', pool, 'live').length === 0)
  check('guard exempts phrases the live description itself already contains', similarityGuard(plantedCopy, pool, plantedCopy).length === 0)
  const facts = extractPatterns(comps)
  console.log('  extracted phrasing patterns (counted):')
  for (const f of facts) console.log('    - ' + f.fact)
  check('phrasing patterns extracted as counted facts', facts.length >= 4)
}
function normWordsCount(t) {
  return (t.match(/[\p{L}\p{N}]+/gu) ?? []).length
}

/* ---------------------------------------------------------------- 4. mock Open Cloud */

const mock = await startMockOpenCloud({ apiKey: KEY })
process.env.ROBLOX_OPEN_CLOUD_BASE = mock.url
console.log(`\n(mock Open Cloud listening on ${mock.url}, MOCK ONLY: no real Roblox Open Cloud call is made in this test)`)

/* ---------------------------------------------------------------- 5. Steal An Egg: iterations 1..4 */

hr('5. Steal An Egg: iteration 1 (no Open Cloud key)')
const memEgg = new Map()
let previous = []
const runs = []
async function run(label, target, memory, secrets) {
  const { ctx, events } = makeCtx({ target, memory, previous, secrets, llm, iterationLabel: label })
  const t0 = Date.now()
  await tool.analyze(ctx)
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  previous = events.findings
  return events
}
const r1 = await run('egg1', TARGETS.egg, memEgg, {})
printRun(r1)
runs.push(r1)
{
  const fs = r1.findings
  check('iteration 1 produced 1 to 3 findings', fs.length >= 1 && fs.length <= 3, `${fs.length}`)
  check('ids are desc:1:<variant>', fs.every((f) => /^desc:1:[ABC]$/.test(f.id)))
  check('every finding has all 8 lint checks and kind description', fs.every((f) => f.detail.kind === 'description' && f.detail.lint.length === 8))
  check('findings are in transparent rank order', fs.every((f, i) => i === 0 || compareRank(rankable(fs[i - 1]), rankable(f)) <= 0))
  check('badges are Best draft / Passes lint / Lint warnings / Blocked by lint', fs.every((f) => ['Best draft', 'Passes lint', 'Lint warnings', 'Blocked by lint'].includes(f.badge.label)))
  check('blocked drafts are ranked after unblocked ones', fs.every((f, i) => i === 0 || !(fs[i - 1].detail.blocked && !f.detail.blocked)))
  check('lint recomputed from the draft text equals the finding (deterministic)', fs.every((f) => lintDescription(draftText(f)).passed === f.detail.lintScore.passed))
  check('word diff added+same text rebuilds the draft', fs.every((f) => f.detail.diffAgainstLive.filter((p) => p.kind !== 'removed').map((p) => p.text).join('').trim() === draftText(f).trim()))
  check('meta carries Characters, Lint score, Unverified claims, Iteration', fs.every((f) => ['Characters', 'Lint score', 'Unverified claims', 'Iteration'].every((l) => f.meta.some((m) => m.label === l))))
  check('Lint score is shown as "N of 8"', fs.every((f) => /^\d of 8$/.test(f.meta.find((m) => m.label === 'Lint score').value)))
  check('snippet is the first line of the draft', fs.every((f) => draftText(f).trimStart().startsWith(f.snippet.map((s) => s.text).join(''))))
  check('competitorsUsed are real roblox.com game links, at most 10', fs[0].detail.competitorsUsed.length > 0 && fs[0].detail.competitorsUsed.length <= 10 && fs[0].detail.competitorsUsed.every((c) => /^https:\/\/www\.roblox\.com\/games\/\d+$/.test(c.url)))
  check('liveText is the real live description', fs[0].detail.liveText.includes('Steal An Egg') && fs[0].detail.liveText.length > 100)
  check('drafts stay within the character limit', fs.every((f) => f.detail.chars <= DESCRIPTION_LIMIT), fs.map((f) => f.detail.chars).join(','))
  const s = r1.summary
  const item = (l) => s.items.find((i) => i.label === l)?.value
  check('summary has Live description, Drafts, Passed lint, Competitors read, Iteration', ['Live description', 'Drafts', 'Passed lint', 'Competitors read', 'Iteration'].every((l) => item(l) !== undefined))
  check('summary says Measured: Not connected without a key', item('Measured') === 'Not connected')
  check('sortLabel is "Best lint score first"', s.sortLabel === 'Best lint score first')
  check('the A/B-test note is present', s.notes.some((n) => /Roblox has no description A\/B test: publish one draft, measure over a full week, then compare/.test(n)))
  check('there is a metadata policy notice', s.notices.some((n) => n.lead === 'Metadata policy'))
  check('no invented lift/CTR numbers anywhere in the output', !JSON.stringify([s, fs]).match(/lift|predicted|\bCTR of\b/i) || /not a prediction/.test(JSON.stringify(s)))
  check('memory has hash, iteration and 1 iteration of drafts', memEgg.get('desc.iteration') === 1 && memEgg.get('desc.history').length === 1 && typeof memEgg.get('desc.live').hash === 'string')
}
function rankable(f) {
  return { lint: { blocked: f.detail.blocked, passed: f.detail.lintScore.passed }, unverified: f.detail.unverifiedClaims.length, chars: f.detail.chars, variant: f.detail.variant }
}

hr('5b. Steal An Egg: iteration 2 (live unchanged)')
const r2 = await run('egg2', TARGETS.egg, memEgg, {})
printRun(r2)
runs.push(r2)
{
  const prevTexts = r1.findings.map(draftText)
  check('iteration 2 ids are desc:2:*', r2.findings.every((f) => /^desc:2:[ABC]$/.test(f.id)))
  check('iteration 2 never repeats an iteration 1 draft (exact)', r2.findings.every((f) => !prevTexts.some((p) => norm(p) === norm(draftText(f)))))
  const maxOverlap = Math.max(...r2.findings.flatMap((f) => prevTexts.map((p) => textOverlap(p, draftText(f)))))
  check('iteration 2 drafts are meaningfully different (3-word phrase overlap < 0.8)', maxOverlap < 0.8, `max overlap ${maxOverlap.toFixed(2)}`)
  check('the memory step says the live description is unchanged', r2.steps.some((s) => s.id === 'memory' && /unchanged/.test(s.detail ?? '')))
  check('memory now holds 2 iterations, iteration 2', memEgg.get('desc.history').length === 2 && memEgg.get('desc.iteration') === 2)
}

hr('5c. Steal An Egg: iteration 3 (live description CHANGED: simulated by mutating memory)')
let r3
{
  const saved = memEgg.get('desc.live')
  // Pretend last time the live description had one extra line and lacked three of today's lines.
  const lines = saved.text.split('\n')
  const mutated = ['A line that used to be on the page.', ...lines.slice(0, Math.max(2, lines.length - 4))].join('\n')
  memEgg.set('desc.live', { hash: 'deadbeefdeadbeef', text: mutated, at: saved.at })
  const expected = lineDiffCounts(mutated, saved.text)
  r3 = await run('egg3', TARGETS.egg, memEgg, {})
  printRun(r3)
  runs.push(r3)
  const n = r3.summary.notices.find((x) => x.lead === 'Live description changed')
  check('a changed live description is reported as a real diff', Boolean(n) && n.body.includes(`+${expected.added} line${expected.added === 1 ? '' : 's'}, -${expected.removed} line${expected.removed === 1 ? '' : 's'}`), n?.body)
  check('the new text became the baseline in memory', memEgg.get('desc.live').hash !== 'deadbeefdeadbeef' && memEgg.get('desc.live').text === saved.text)
  const earlierTexts = [...r1.findings, ...r2.findings].map(draftText)
  const maxO = Math.max(...r3.findings.flatMap((f) => earlierTexts.map((p) => textOverlap(p, draftText(f)))))
  check('iteration 3 drafts do not repeat iterations 1 or 2', maxO < 0.8, `max overlap ${maxO.toFixed(2)}`)
}

hr('5d. Steal An Egg: iteration 4 (memory keeps at most the last 3 iterations)')
const r4 = await run('egg4', TARGETS.egg, memEgg, {})
runs.push(r4)
{
  const hist = memEgg.get('desc.history')
  check('memory keeps only the last 3 iterations of drafts', hist.length === 3 && hist.map((h) => h.iteration).join(',') === '2,3,4', hist.map((h) => h.iteration).join(','))
  const all = [...r1.findings, ...r2.findings, ...r3.findings].map(draftText)
  const maxO = Math.max(...r4.findings.flatMap((f) => all.map((p) => textOverlap(p, draftText(f)))))
  check('iteration 4 drafts differ from every earlier draft', maxO < 0.8, `max overlap ${maxO.toFixed(2)}`)
  console.log('  iteration 4 titles: ' + r4.findings.map((f) => `${f.id} ${f.badge.label} ${f.detail.lintScore.passed}/8`).join(' | '))
}

/* ---------------------------------------------------------------- 6. Fisch with a (mock) Open Cloud key */

hr('6. Fisch, iteration 1, WITH a mock Open Cloud key (analytics path is MOCK only)')
previous = []
const memFisch = new Map()
const rf = await run('fisch1', TARGETS.fisch, memFisch, { 'roblox-open-cloud-key': KEY })
printRun(rf)
{
  check('Fisch produced drafts', rf.findings.length >= 1)
  check('live Fisch description is the real one', rf.findings[0].detail.liveText.includes('Fisch'))
  const posts = mock.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/metrics'))
  const gets = mock.calls.filter((c) => c.method === 'GET' && c.path.includes('/operations/metrics/'))
  check('the analytics submit used POST .../analytics-query-api/v1/universes/{id}/metrics with x-api-key', posts.length >= 3 && posts.every((c) => c.hasKey && c.path.includes(`/universes/${TARGETS.fisch.universeId}/metrics`)))
  check('the 429 + Retry-After was honoured (the throttled query was retried)', posts.filter((c) => c.body.metric === 'RFYPlayThroughRate').length === 2)
  check('a 202 answer was polled through GET {path} until done', gets.length >= 2 && gets.every((c) => c.hasKey))
  check('requested metrics include RFYPlayThroughRate over 14 whole UTC days', (() => { const b = posts.find((c) => c.body.metric === 'RFYPlayThroughRate').body; return Math.round((new Date(b.endTime) - new Date(b.startTime)) / 86_400_000) === 14 && b.granularity === 'OneDay' })())
  const m = rf.summary.items.find((i) => i.label === 'Measured')
  check('summary shows Measured with the value as returned (mock mean 0.0565 over 14 days)', Boolean(m) && /0\.0565/.test(m.value) && /14 days/.test(m.value), m?.value)
  check('the key never appears in any output', !JSON.stringify([rf.summary, rf.findings, rf.steps]).includes(KEY))
}

hr('6b. Open Cloud with a wrong key: reported without the key, run still completes')
{
  const { ctx, events } = makeCtx({ target: TARGETS.fisch, memory: new Map(), secrets: { 'roblox-open-cloud-key': 'wrong-key-123456' }, llm, iterationLabel: 'fisch-wrong' })
  // Reuse the baseline path only: call the analyzer but it will draft again; instead test fetchBaseline directly (the analyzer calls exactly this).
  void ctx
  void events
  const { fetchBaseline } = await import('../tools/description-opencloud.ts')
  const b = await fetchBaseline('wrong-key-123456', TARGETS.fisch.universeId, new Date())
  check('a rejected key yields "unavailable" with a reason, never throws', b.metrics.length >= 1 && b.metrics[0].mean === null && /rejected the key/.test(b.metrics[0].unavailable), b.metrics[0].unavailable)
  check('the wrong key is not echoed', !JSON.stringify(b).includes('wrong-key-123456'))
}

/* ---------------------------------------------------------------- 7. publish route against the mock */

hr('7. POST /api/description/publish against the mock')
{
  const publish = tool.routes['POST /api/description/publish']
  const status = tool.routes['GET /api/description/status']
  const callRoute = async (handler, body, secrets) => {
    let out
    await handler({ req: {}, res: {}, url: new URL('http://x/'), body: async () => body, json: (s, d) => (out = { status: s, data: d }), secrets: { get: (n) => secrets[n] ?? null, has: (n) => n in secrets, set() {}, remove() {} } })
    return out
  }
  const goodText = 'Cast a line, catch rare fish and upgrade your rod in a calm open world.\n\nHow to play:\n- Hold to cast\n- Reel in the catch\n- Sell fish to buy better gear'
  const before = mock.calls.filter((c) => c.method === 'PATCH').length
  const patches = () => mock.calls.filter((c) => c.method === 'PATCH')

  let r = await callRoute(status, undefined, { 'roblox-open-cloud-key': KEY })
  check('status route: connected true with a key', r.status === 200 && r.data.connected === true && r.data.limit === DESCRIPTION_LIMIT)
  r = await callRoute(status, undefined, {})
  check('status route: connected false without a key', r.data.connected === false)

  r = await callRoute(publish, { universeId: 123456, text: goodText }, { 'roblox-open-cloud-key': KEY })
  check('no confirm => 400 and nothing sent', r.status === 400 && r.data.code === 'confirm-required' && patches().length === before)
  r = await callRoute(publish, { universeId: 123456, text: goodText, confirm: 'true' }, { 'roblox-open-cloud-key': KEY })
  check('confirm must be the boolean true', r.status === 400 && patches().length === before)
  r = await callRoute(publish, { universeId: 123456, text: 'Catch fish.\n\nFREE ROBUX giveaway every 10 min!!!', confirm: true }, { 'roblox-open-cloud-key': KEY })
  check('text that fails lint => 422 with the failed checks, nothing sent', r.status === 422 && r.data.code === 'lint-failed' && r.data.lint.some((l) => l.id === 'giveaway') && patches().length === before, r.data.message)
  r = await callRoute(publish, { universeId: 123456, text: goodText, confirm: true }, {})
  check('no key => 409, nothing sent', r.status === 409 && r.data.code === 'no-key' && patches().length === before)
  r = await callRoute(publish, { universeId: 'abc', text: goodText, confirm: true }, { 'roblox-open-cloud-key': KEY })
  check('bad universeId => 400', r.status === 400)
  r = await callRoute(publish, { universeId: 123456, text: goodText, confirm: true }, { 'roblox-open-cloud-key': KEY })
  const p = patches()[patches().length - 1]
  check('confirm + passing lint + key => 200 and exactly one PATCH', r.status === 200 && r.data.ok === true && patches().length === before + 1, JSON.stringify({ status: r.status, robloxStatus: r.data.robloxStatus, endpoint: r.data.endpoint?.replace(mock.url, '<mock>') }))
  check('PATCH went to /cloud/v2/universes/123456 with updateMask=description, x-api-key and { description }', p.path === '/cloud/v2/universes/123456' && p.search === '?updateMask=description' && p.hasKey && p.body.description === goodText)
  check('the mock stored exactly the published text', mock.universes.get('123456')?.description === goodText)
  check('the response carries what Roblox answered and never the key', r.data.robloxStatus === 200 && !JSON.stringify(r.data).includes(KEY))
  r = await callRoute(publish, { universeId: 404404, text: goodText, confirm: true }, { 'roblox-open-cloud-key': KEY })
  check('a Roblox 404 is passed on as an error with Roblox\'s status, no key', r.status === 502 && r.data.robloxStatus === 404 && !JSON.stringify(r.data).includes(KEY), r.data.message)
  r = await callRoute(publish, { universeId: 123456, text: goodText, confirm: true }, { 'roblox-open-cloud-key': 'wrong-key-123456' })
  check('a rejected key => Roblox 401 reported without the key', r.status === 502 && r.data.robloxStatus === 401 && !JSON.stringify(r.data).includes('wrong-key-123456'), r.data.message)
}

if (process.env.DESC_DUMP) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(process.env.DESC_DUMP, JSON.stringify({ egg1: r1, egg2: r2, egg3: r3, egg4: r4, fisch: rf }, null, 1))
  console.log(`(real run output written to ${process.env.DESC_DUMP})`)
}
await mock.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
