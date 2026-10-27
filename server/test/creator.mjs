// Creator Dox against REAL YouTube and the REAL LLM. Needs the OpenRouter key in the environment, inline:
//   OPENROUTER_API_KEY="$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null)" node server/test/creator.mjs [steal|fisch|all]
// For each game: runs the analyzer, prints the ranked creators, prints one full detail, verifies every URL points at a
// channel/video id that appeared in a page the run actually fetched, and runs it again with the same memory to prove
// nothing already tracked is marked New. CREATOR_DUMP=<file> also writes the findings as JSON (for rendering the view).
import { tool } from '../tools/creator.ts'
import { createLlm, DEFAULT_ANALYSIS_MODEL } from '../llm.ts'

const key = process.env.OPENROUTER_API_KEY ?? ''
if (!key) {
  console.error('OPENROUTER_API_KEY is not set (pass it inline from the keychain).')
  process.exit(2)
}
const GAMES = {
  steal: { universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' },
  fisch: { universeId: 5750914919, placeId: 16732694052, name: 'Fisch' },
}
const which = process.argv[2] ?? 'all'

// Record every id that appears in any YouTube page the run fetches.
const seenIds = new Set()
let pagesFetched = 0
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init)
  const url = typeof input === 'string' ? input : input.url
  if (/youtube\.com/.test(url) && res.ok) {
    pagesFetched++
    const body = await res.clone().text()
    for (const m of body.matchAll(/"(?:videoId|contentId|externalId|browseId|channelId)":"([\w-]{11,24})"/g)) seenIds.add(m[1])
    for (const m of body.matchAll(/\/watch\?v=([\w-]{11})/g)) seenIds.add(m[1])
    for (const m of body.matchAll(/channel\/(UC[\w-]{22})/g)) seenIds.add(m[1])
  }
  return res
}

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

function makeCtx(target, memStore) {
  const events = { steps: [], findings: [], summary: null }
  const ac = new AbortController()
  const ctx = {
    tool: 'creator-dox',
    target: { kind: 'roblox-game', ...target },
    trigger: 'user',
    runId: 'test',
    daemonId: 'test',
    now: new Date(),
    signal: ac.signal,
    step: (id, label, state, detail) => {
      events.steps.push({ id, label, state, detail })
      if (state !== 'active') console.log(`  step ${state.padEnd(6)} ${label}${detail ? ' :: ' + detail : ''}`)
    },
    summary: (s) => (events.summary = s),
    finding: (f) => events.findings.push(JSON.parse(JSON.stringify(f))),
    llm: createLlm({ key, baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL }),
    secrets: { get: () => null, has: () => false },
    memory: { get: (k) => (memStore.has(k) ? JSON.parse(memStore.get(k)) : undefined), set: (k, v) => memStore.set(k, JSON.stringify(v)) },
    previous: [],
  }
  return { ctx, events }
}

const idOf = (u) => /watch\?v=([\w-]{11})$/.exec(u)?.[1] ?? /channel\/(UC[\w-]{22})$/.exec(u)?.[1] ?? null

async function runGame(name, target) {
  console.log(`\n=== ${name} ===`)
  const mem = new Map()
  const t0 = Date.now()
  const { ctx, events } = makeCtx(target, mem)
  await tool.analyze(ctx)
  console.log(`run 1 took ${Math.round((Date.now() - t0) / 1000)}s, ${pagesFetched} YouTube pages fetched so far`)
  console.log('summary:', events.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '))
  console.log('sort:', events.summary.sortLabel, '|', events.summary.notes?.join(' '))
  console.log('notice:', events.summary.notices?.map((n) => `${n.lead} ${n.body}`).join(' '))
  const fs = events.findings
  check(`${name}: found creators`, fs.length > 0, String(fs.length))
  console.log('\nRank  Fit  Tier         Creator                         Subs     Median     Spons  URL')
  fs.forEach((f, i) => {
    const d = f.detail
    console.log(
      `${String(i + 1).padStart(3)}   ${String(d.fit.score).padStart(3)}  ${d.fit.tier.padEnd(11)}  ${f.title.slice(0, 30).padEnd(30)}  ${f.meta[0].value.padStart(7)}  ${f.meta[1].value.padStart(8)}  ${f.meta[2].value.padStart(5)}  ${f.url}`,
    )
  })
  const nonRisky = fs.filter((f) => f.detail.fit.tier !== 'Risky')
  check(`${name}: ranked by fit, Risky last`, nonRisky.every((f, i) => i === 0 || nonRisky[i - 1].detail.fit.score >= f.detail.fit.score) && fs.slice(nonRisky.length).every((f) => f.detail.fit.tier === 'Risky'))
  check(`${name}: first run marks every creator New`, fs.every((f) => f.status.label === 'New'))
  check(`${name}: finding ids are creator:<channelId>`, fs.every((f) => f.id === `creator:${f.detail.channel.id}`))
  let invariants = true
  for (const f of fs) {
    const d = f.detail
    if (d.fit.components.reduce((n, c) => n + c.points, 0) !== d.fit.score) invariants = false
    if (d.sponsorship.deltaPct !== null && !(d.sponsorship.sponsored >= 3 && d.sponsorship.organic >= 3)) invariants = false
    if (d.sponsorship.deltaPct === null && d.sponsorship.sponsored >= 3 && d.sponsorship.organic >= 3) invariants = false
    if (d.contact.email && !d.channel.description.includes(d.contact.email) && !d.contact.lines.some((l) => l.includes(d.contact.email))) invariants = false
    if (d.brandSafety.flags.some((x) => !x.evidenceTitle)) invariants = false
    if (d.fit.tier === 'Risky' && !d.brandSafety.flags.some((x) => x.confidence === 'high')) invariants = false
    if (/[—·]/.test(JSON.stringify(d.talkingPoints))) invariants = false
  }
  check(`${name}: components sum to score; delta only with 3+3; email only if published; Risky only with a high flag; no em dash`, invariants)

  const bad = []
  let urls = 0
  const verify = (u) => {
    urls++
    const id = idOf(u)
    if (!id || !seenIds.has(id)) bad.push(u)
  }
  for (const f of fs) {
    verify(f.url)
    const d = f.detail
    verify(d.channel.url)
    d.gameVideos.forEach((v) => verify(v.url))
    d.sponsorship.examples.forEach((v) => verify(v.url))
    d.brandSafety.flags.forEach((v) => verify(v.url))
  }
  check(`${name}: all ${urls} URLs point at ids present in fetched pages`, bad.length === 0, bad.slice(0, 3).join(' '))

  if (process.env.CREATOR_DUMP) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.CREATOR_DUMP, JSON.stringify({ [name]: { findings: fs, summary: events.summary } }, null, 1))
  }
  if (fs.length) {
    const sample = fs.find((f) => f.detail.sponsorship.sponsored > 0) ?? fs[0]
    console.log(`\n--- full detail: ${sample.title} (${sample.id}) ---`)
    console.log(JSON.stringify({ snippet: sample.snippet, meta: sample.meta, status: sample.status, states: sample.states, group: sample.group, url: sample.url }, null, 1))
    console.log(JSON.stringify(sample.detail, null, 1))
  }

  console.log('\n(rerun with the daemon memory from run 1)')
  const second = makeCtx(target, mem)
  await tool.analyze(second.ctx)
  const first = new Set(fs.map((f) => f.id))
  const again = second.events.findings
  const wrongNew = again.filter((f) => f.status.label === 'New' && first.has(f.id))
  const trulyNew = again.filter((f) => f.status.label === 'New' && !first.has(f.id))
  check(`${name}: rerun marks no earlier creator as New`, wrongNew.length === 0, `${again.length} creators, ${again.filter((f) => f.status.label === 'Tracked').length} Tracked`)
  console.log(trulyNew.length ? `note: creators that were not in run 1 and are therefore New: ${trulyNew.map((f) => f.title).join(', ')}` : 'rerun: nothing marked New')
  return { findings: fs, summary: events.summary }
}

const all = {}
const { writeFileSync } = await import('node:fs')
for (const [k, t] of Object.entries(GAMES)) {
  if (which !== 'all' && which !== k) continue
  all[k] = await runGame(t.name, t)
  if (process.env.CREATOR_DUMP) {
    writeFileSync(process.env.CREATOR_DUMP, JSON.stringify(all, null, 1))
    console.log('dumped findings to', process.env.CREATOR_DUMP)
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
