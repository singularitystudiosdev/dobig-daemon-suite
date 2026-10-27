// Rank Daemon against REAL Roblox search (and the real model when OPENROUTER_API_KEY is set):
//   node server/test/rank.mjs [steal|fisch|all]
// For each game it runs the analyzer twice with a fake RunContext, then a third time against edited memory
// ("simulated memory") to prove the diff logic for a drop, a climb, a loss, a return and who passed the game.
// Checks: phrases are non-empty and emoji free, positions are integers >= 1 or null and equal an independent
// recount of the fetched pages with ads set aside, every neighbour link is roblox.com/games/<placeId> of a game
// that was in that phrase's fetched page, run 1 says First read, run 2 agrees with memory, no em dashes in generated
// strings, and one run stays under 90 Roblox requests.
import { createLlm, DEFAULT_ANALYSIS_MODEL } from '../llm.ts'
import { classify, orderFindings, passersOf, tool } from '../tools/rank.ts'
import { assemblePhrases, descriptionPhrases, hasEmoji, nameVariants, phraseKey } from '../tools/rank-phrases.ts'
import { fetchGameFacts, readPhrase } from '../tools/rank-search.ts'

const GAMES = {
  steal: { label: 'Steal An Egg', target: { universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' }, llm: true },
  fisch: { label: 'Fisch', target: { universeId: 5750914919, placeId: 16732694052, name: 'Fisch' }, llm: false },
}
const which = process.argv[2] ?? 'all'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

/* ---- record every Roblox call and every omni-search page ---- */
const realFetch = globalThis.fetch
let robloxCalls = 0
/** phrase -> ordered pages of [{ placeId, universeId, sponsored }] from the most recent run of that phrase */
let pagesByPhrase = new Map()
const sessionPhrase = new Map()
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  const res = await realFetch(input, init)
  if (/roblox\.com/.test(url)) robloxCalls++
  if (url.includes('omni-search') && res.status === 200) {
    try {
      const u = new URL(url)
      const phrase = u.searchParams.get('searchQuery')
      const sid = u.searchParams.get('sessionId')
      const body = await res.clone().json()
      const items = []
      for (const g of body.searchResults ?? []) {
        if (g.contentGroupType !== 'Game') continue
        for (const c of g.contents ?? []) items.push({ placeId: c.rootPlaceId, universeId: c.universeId, sponsored: c.isSponsored === true, name: c.name })
      }
      if (!sessionPhrase.has(sid)) {
        sessionPhrase.set(sid, phrase)
        pagesByPhrase.set(phrase, [])
      }
      pagesByPhrase.get(phrase).push(items)
    } catch {
      /* body unreadable */
    }
  }
  return res
}

function makeCtx(game, memStore, llm) {
  const events = { steps: [], findings: [], summary: null }
  const ac = new AbortController()
  const ctx = {
    tool: 'rank-daemon',
    target: { kind: 'roblox-game', ...game.target },
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
    llm,
    secrets: { get: () => null, has: () => false },
    memory: { get: (k) => (memStore.has(k) ? JSON.parse(memStore.get(k)) : undefined), set: (k, v) => memStore.set(k, JSON.stringify(v)) },
    previous: [],
  }
  return { ctx, events }
}

const noLlm = { available: false, model: 'none', json: async () => { throw new Error('no key') } }
const key = process.env.OPENROUTER_API_KEY
const realLlm = key ? createLlm({ key, baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL }) : noLlm

async function run(game, mem, llm) {
  pagesByPhrase = new Map()
  sessionPhrase.clear()
  robloxCalls = 0
  const { ctx, events } = makeCtx(game, mem, llm)
  const t0 = Date.now()
  await tool.analyze(ctx)
  const secs = Math.round((Date.now() - t0) / 1000)
  return { events, calls: robloxCalls, pages: new Map(pagesByPhrase), secs }
}

/** The position an independent reader gets from the fetched pages: ads set aside, repeats ignored, first 100 only. */
function recount(pages, game) {
  const seen = new Set()
  let n = 0
  for (const page of pages ?? []) {
    for (const h of page) {
      if (seen.has(h.universeId)) continue
      seen.add(h.universeId)
      if (h.sponsored) continue
      if (++n > 100) return null
      if (h.universeId === game.target.universeId) return n
    }
  }
  return null
}

const DASH = /[‒-―−]/
const MIDDLE_DOT = /[·•]/
function generatedText(f) {
  // game names inside neighbour rows are Roblox data, not generated text
  const copy = JSON.parse(JSON.stringify(f))
  delete copy.detail.around
  delete copy.detail.passed
  delete copy.detail.gameName
  return JSON.stringify(copy)
}

function line(f) {
  return `  [${f.badge.label}] ${f.title} | pos ${f.meta[0].value}, before ${f.meta[1].value}, players above ${f.meta[2].value} | ${f.snippet.map((s) => s.text).join('')} | ${f.status.label}`
}

function structural(label, r, game, expectLlm) {
  const F = r.events.findings
  const S = r.events.summary
  check(`${label}: phrases are 1..14`, F.length >= 1 && F.length <= 14, `n=${F.length}`)
  check(`${label}: every phrase is a non-empty string with no emoji, and unique`, F.every((f) => typeof f.title === 'string' && f.title.trim() === f.title && f.title.length > 0 && !hasEmoji(f.title) && f.detail.phrase === f.title) && new Set(F.map((f) => phraseKey(f.title))).size === F.length)
  check(`${label}: positions are integers >= 1 or null`, F.every((f) => f.detail.position === null || (Number.isInteger(f.detail.position) && f.detail.position >= 1 && f.detail.position <= 100)))
  const mismatches = F.filter((f) => f.detail.position !== recount(r.pages.get(f.title), game))
  check(`${label}: each position equals an independent recount of the fetched pages with ads set aside`, mismatches.length === 0, mismatches.map((f) => `${f.title}: ${f.detail.position} vs ${recount(r.pages.get(f.title), game)}`).join('; '))
  const badLinks = []
  let ads = 0
  for (const f of F) {
    const ids = new Set((r.pages.get(f.title) ?? []).flat().map((h) => h.placeId))
    for (const n of f.detail.around) {
      const m = /^https:\/\/www\.roblox\.com\/games\/(\d+)$/.exec(n.url)
      if (!m || Number(m[1]) !== n.placeId || !ids.has(n.placeId)) badLinks.push(`${f.title}: ${n.url}`)
      if (n.sponsored) {
        ads++
        if (n.position !== null) badLinks.push(`${f.title}: ad has a position`)
      }
    }
    for (const n of f.detail.passed) if (!ids.has(n.placeId) || n.url !== `https://www.roblox.com/games/${n.placeId}`) badLinks.push(`${f.title}: passed ${n.url}`)
  }
  check(`${label}: every neighbour link is roblox.com/games/<placeId> of a game in that phrase's fetched page; ads carry no position`, badLinks.length === 0, `${badLinks.slice(0, 3).join('; ')} (ads shown: ${ads})`)
  const around = F.filter((f) => f.detail.aroundKind === 'around')
  check(`${label}: found phrases show the game itself and up to ten others around it`, around.every((f) => f.detail.around.filter((n) => !n.sponsored && n.position !== f.detail.position).length <= 10 && f.detail.around.some((n) => n.position === f.detail.position)))
  const text = F.map(generatedText).join('\n') + JSON.stringify(S) + JSON.stringify(r.events.steps)
  check(`${label}: no em dashes, en dashes or middle dots in generated strings`, !DASH.test(text) && !MIDDLE_DOT.test(text))
  check(`${label}: summary items and sort label`, S.items.map((i) => i.label).join('|') === 'Phrases searched|In the top 3|In the top 10|Dropped|Climbed|Not found' && S.sortLabel === 'Biggest drops first')
  check(`${label}: summary note about player differences and no login`, S.notes.some((n) => /differ by player/.test(n) && /without a login/.test(n)))
  check(`${label}: summary counts match the findings`, S.items[0].value === String(F.length) && S.items[1].value === String(F.filter((f) => f.detail.position !== null && f.detail.position <= 3).length) && S.items[2].value === String(F.filter((f) => f.detail.position !== null && f.detail.position <= 10).length) && S.items[5].value === String(F.filter((f) => f.detail.position === null).length))
  const order = ['lost', 'dropped', 'new', 'climbed', 'first', 'steady', 'absent']
  check(`${label}: findings are ordered lost, dropped, new, climbed, first, steady`, F.every((f, i) => i === 0 || order.indexOf(F[i - 1].detail.status) <= order.indexOf(f.detail.status)))
  const drops = F.filter((f) => f.detail.status === 'dropped').map((f) => Math.abs(f.detail.change))
  check(`${label}: dropped rows are largest first`, drops.every((d, i) => i === 0 || drops[i - 1] >= d))
  check(`${label}: one run under 90 Roblox requests`, r.calls < 90, `calls=${r.calls}`)
  const model = F.filter((f) => f.detail.source === 'model').length
  check(`${label}: ${expectLlm ? 'model phrases present (6 to 10 target)' : 'no model phrases without a key'}`, expectLlm ? model >= 1 && model <= 10 : model === 0, `model=${model}`)
  check(`${label}: one finding id per phrase, stable form`, F.every((f) => f.id === `rank:${phraseKey(f.title)}`))
  check(`${label}: row has a rank chip, three meta values, status chip and a roblox.com search link`, F.every((f) => f.badge.label && f.meta.length === 3 && f.status.label && /^https:\/\/www\.roblox\.com\/discover\/\?Keyword=/.test(f.url)))
}

async function runGame(g) {
  const game = GAMES[g]
  const label = game.label
  console.log(`\n=== ${label} ===`)
  const expectLlm = game.llm && !!key
  const llm = game.llm ? realLlm : noLlm
  const mem = new Map()

  const r1 = await run(game, mem, llm)
  console.log(`run 1: ${r1.events.findings.length} findings, ${r1.calls} Roblox requests, ${r1.secs}s`)
  console.log('summary:', r1.events.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '), '| sort:', r1.events.summary.sortLabel)
  console.log('findings slice (first 8):')
  r1.events.findings.slice(0, 8).forEach((f) => console.log(line(f)))
  console.log('phrases:', r1.events.findings.map((f) => `${f.title} (${f.detail.source})`).join(' / '))
  structural(`${label} run 1`, r1, game, expectLlm)
  check(`${label} run 1: everything says First read, no previous, no passers known`, r1.events.findings.every((f) => f.badge.label === 'First read' && f.detail.status === 'first' && f.detail.previous === null && !f.detail.hadPrevious && f.meta[1].value === 'None' && f.detail.history.length === 1 && !f.detail.passedKnown))
  check(`${label} run 1: summary says nothing to compare with yet`, r1.events.summary.notes.some((n) => /first read/i.test(n)))
  check(`${label} run 1: every step ends done or warn`, ['game', 'phrases', 'search', 'compare'].every((id) => { const last = [...r1.events.steps].reverse().find((s) => s.id === id); return last && (last.state === 'done' || last.state === 'warn') }))
  const mem1 = new Map(mem)

  const r2 = await run(game, mem, llm)
  console.log(`run 2: ${r2.events.findings.length} findings, ${r2.calls} Roblox requests, ${r2.secs}s`)
  console.log('findings slice, run 2 (first 8):')
  r2.events.findings.slice(0, 8).forEach((f) => console.log(line(f)))
  structural(`${label} run 2`, r2, game, expectLlm)
  const prev1 = new Map(r1.events.findings.map((f) => [f.title, f.detail.position]))
  const consistent = r2.events.findings.every((f) => {
    if (!prev1.has(f.title)) return false
    const before = prev1.get(f.title)
    const now = f.detail.position
    const want = before === null ? (now === null ? 'absent' : 'new') : now === null ? 'lost' : now < before ? 'climbed' : now > before ? 'dropped' : 'steady'
    return f.detail.status === want && f.detail.previous === before && f.detail.hadPrevious && f.detail.history.length === 2 && (before === null || now === null || f.detail.change === before - now)
  })
  check(`${label} run 2: same phrases as run 1, each status agrees with the position memory held`, consistent && r2.events.findings.length === r1.events.findings.length)
  check(`${label} run 2: steady rows say Steady, climbed Up n, dropped Dropped n`, r2.events.findings.every((f) => ({ steady: /^Steady$/, climbed: /^Up \d+$/, dropped: /^Dropped \d+$/, lost: /^Lost$/, new: /^New$/, absent: /^Not found$/ })[f.detail.status].test(f.badge.label)))
  check(`${label} run 2: a rerun keeps the sparkline data inverted (higher is better) with an aria label`, r2.events.findings.every((f) => f.spark && f.spark.data.length === 2 && f.spark.label.includes('A higher line is a better position') && f.spark.data.every((v, i) => v === 101 - (f.detail.history[i].position ?? 101))))
  check(`${label} run 2: the tracked phrase set does not drift between runs`, [...prev1.keys()].sort().join('|') === r2.events.findings.map((f) => f.title).sort().join('|'))

  // ---- simulated memory: edit what run 1 stored, run again live, and check the diff words ----
  const sim = new Map(mem1)
  const stored = JSON.parse(sim.get('rank'))
  const byTitle = new Map(r1.events.findings.map((f) => [f.title, f]))
  const found = r1.events.findings.filter((f) => f.detail.position !== null)
  const missing = r1.events.findings.filter((f) => f.detail.position === null)
  const dropPick = found.find((f) => f.detail.position >= 2)
  const climbPick = found.find((f) => f !== dropPick)
  const newPick = found.find((f) => f !== dropPick && f !== climbPick)
  const lostPick = missing[0]
  const me = game.target.placeId
  const expect = new Map()
  const k = (f) => phraseKey(f.title)
  if (dropPick) {
    // it was position 1 last run and every game now above it was below it then
    const organic = (r1.pages.get(dropPick.title) ?? []).flat().filter((h) => !h.sponsored).map((h) => h.placeId)
    const others = organic.filter((id) => id !== me)
    stored.phrases[k(dropPick)].hist.at(-1).position = 1
    stored.phrases[k(dropPick)].ids = [me, ...others]
    expect.set(dropPick.title, { status: 'dropped', previous: 1 })
  }
  if (climbPick) {
    const p = climbPick.detail.position
    stored.phrases[k(climbPick)].hist.at(-1).position = p + 7
    stored.phrases[k(climbPick)].ids = [...Array(p + 6).fill(1), me, 2, 3]
    expect.set(climbPick.title, { status: 'climbed', previous: p + 7 })
  }
  if (newPick) {
    stored.phrases[k(newPick)].hist.at(-1).position = null
    expect.set(newPick.title, { status: 'new', previous: null })
  }
  if (lostPick) {
    stored.phrases[k(lostPick)].hist.at(-1).position = 5
    expect.set(lostPick.title, { status: 'lost', previous: 5 })
  }
  sim.set('rank', JSON.stringify(stored))
  const r3 = await run(game, sim, llm)
  console.log(`run 3 (simulated memory): ${r3.events.findings.length} findings, ${r3.calls} Roblox requests, ${r3.secs}s`)
  console.log('findings slice, simulated memory (first 8):')
  r3.events.findings.slice(0, 8).forEach((f) => console.log(line(f)))
  structural(`${label} simulated memory`, r3, game, expectLlm)
  const get = (t) => r3.events.findings.find((f) => f.title === t)
  for (const [t, want] of expect) {
    const f = get(t)
    const live = byTitle.get(t).detail.position
    // a live position that moved between runs can still be steady only if it equals the edited baseline; the edited baseline never does
    check(`${label} simulated memory: "${t}" is ${want.status}, previous ${want.previous}`, f && f.detail.status === want.status && f.detail.previous === want.previous, `now ${f?.detail.position}, run 1 had ${live}, badge "${f?.badge.label}"`)
  }
  if (dropPick) {
    const f = get(dropPick.title)
    check(`${label} simulated memory: dropped by exactly now minus 1 and the badge says so`, f.detail.change === 1 - f.detail.position && f.badge.label === `Dropped ${f.detail.position - 1}`, f.badge.label)
    const above = f.detail.position === null ? [] : r3.events.findings && (r3.pages.get(f.title) ?? []).flat().filter((h) => !h.sponsored).map((h) => h.placeId).filter((id) => id !== me).slice(0, f.detail.position - 1)
    check(`${label} simulated memory: who passed you lists the games now above (all were below before)`, f.detail.passedKnown && f.detail.passed.length === above.length && f.detail.passed.every((p, i) => p.placeId === above[i] && p.was > 1 && p.now === i + 1), `passed=${f.detail.passed.length}`)
    check(`${label} simulated memory: snippet names who passed`, above.length === 0 || /passed you/.test(f.snippet[0].text), f.snippet[0].text)
  }
  if (climbPick) {
    const f = get(climbPick.title)
    check(`${label} simulated memory: climbed row says Up ${climbPick.detail.position === null ? '' : 7}`, f.badge.label === `Up ${f.detail.change}` && f.detail.change === f.detail.previous - f.detail.position)
    check(`${label} simulated memory: nobody passed a climbing game, and that is known`, f.detail.passedKnown && f.detail.passed.length === 0)
  }
  if (lostPick) {
    const f = get(lostPick.title)
    check(`${label} simulated memory: lost row says Was position 5 and shows the top results instead`, f.badge.label === 'Lost' && /Was position 5/.test(f.snippet[0].text) && f.detail.aroundKind === 'top' && f.meta[0].value === '100+' && f.meta[1].value === '5')
  }
  const lostFirst = r3.events.findings.findIndex((f) => f.detail.status === 'lost')
  check(`${label} simulated memory: the lost phrase is listed first`, !lostPick || lostFirst === 0)
  console.log('findings (simulated memory) statuses:', r3.events.findings.map((f) => `${f.badge.label}:${f.title}`).join(' / '))
}

/* ---- pure units that need no network ---- */
{
  check('phrases: name variants drop brackets, emoji and punctuation', JSON.stringify(nameVariants('[🎃] Steal A Monkey Egg!')) === JSON.stringify(['Steal A Monkey Egg!', 'steal monkey egg']), JSON.stringify(nameVariants('[🎃] Steal A Monkey Egg!')))
  check('phrases: Fisch 👻 [HORSEMAN] is just Fisch', JSON.stringify(nameVariants('Fisch 👻 [HORSEMAN]')) === JSON.stringify(['Fisch']))
  const d = descriptionPhrases('Hatch rare pets. Hatch rare pets! Earn money from your pets. Upgrade the treadmill and the treadmill base.', 'Egg Game', 5)
  check('phrases: description words are stop-word free and come from the text', d.length > 0 && d.every((p) => p.split(' ').every((w) => /^[a-z']+$/.test(w) && !['from', 'your', 'the', 'and'].includes(w) && 'hatch rare pets earn money upgrade treadmill base'.split(' ').includes(w))), d.join(' / '))
  const only = descriptionPhrases('Hatch rare pets. Hatch rare pets! Earn money from your pets. Upgrade the treadmill and the treadmill base.', 'Egg Game', 5)
  check('phrases: pairs the writer put side by side lead, nothing invented', only.every((p) => ['hatch rare', 'rare pets', 'pets', 'treadmill', 'hatch', 'rare', 'earn', 'money', 'upgrade', 'base'].includes(p)) && only[0] === 'hatch rare', only.join(' / '))
  const spec = assemblePhrases({ name: 'X Game', description: 'alpha beta alpha beta gamma gamma', genre: 'All', genreL1: 'Action', genreL2: '' }, ['aa bb', 'cc dd', 'x game'])
  check('phrases: model phrases dedupe against the game ones, total capped at 14', spec.length <= 14 && spec.filter((s) => phraseKey(s.phrase) === 'x game').length === 1 && spec.some((s) => s.source === 'model'))
  const many = assemblePhrases({ name: 'Big Game Name Here', description: 'one two three four five six seven eight nine ten '.repeat(3), genre: 'Adventure', genreL1: 'Action', genreL2: 'Fantasy' }, Array.from({ length: 12 }, (_, i) => `model phrase ${'abcdefghijkl'[i]}`))
  check('phrases: at most 14 with a full model list', many.length === 14 && many.filter((s) => s.source === 'model').length >= 6, `n=${many.length} model=${many.filter((s) => s.source === 'model').length}`)
  // the diff rules on their own
  const H = (...p) => ({ hist: p.map((position, i) => ({ at: `2026-10-0${i + 1}`, position })), ids: [] })
  check('diff: no memory is first', classify(4, undefined).status === 'first' && classify(null, H()).status === 'first')
  check('diff: climbed, dropped, steady, new, lost, absent', classify(3, H(7)).status === 'climbed' && classify(3, H(7)).change === 4 && classify(9, H(2)).status === 'dropped' && classify(9, H(2)).change === -7 && classify(5, H(5)).status === 'steady' && classify(5, H(null)).status === 'new' && classify(null, H(5)).status === 'lost' && classify(null, H(null)).status === 'absent')
  check('diff: a return after a lost run is still new, and everFound says it was found earlier', classify(5, H(3, null)).status === 'new' && classify(5, H(3, null)).everFound === true)
  const org = [{ placeId: 11, name: 'A' }, { placeId: 12, name: 'B' }, { placeId: 99, name: 'Me' }, { placeId: 13, name: 'C' }]
  const pr = { hist: [{ at: 'x', position: 2 }], ids: [12, 99, 11, 13] }
  const ps = passersOf(pr, 99, org, 3)
  check('diff: passers are games that were below the game before and are above it now', ps && ps.length === 1 && ps[0].placeId === 11 && ps[0].was === 3 && ps[0].now === 1, JSON.stringify(ps))
  check('diff: passers unknown without an earlier order', passersOf(H(2), 99, org, 3) === null && passersOf(pr, 99, org, null) === null && passersOf({ hist: [{ at: 'x', position: 3 }], ids: [12, 99, 11] }, 99, org, 3) === null)
  const mk = (status, change, position, phrase) => ({ detail: { status, change, position, previous: null, phrase } })
  const o = orderFindings([mk('steady', 0, 1, 'a'), mk('climbed', 2, 3, 'b'), mk('dropped', -2, 5, 'c'), mk('lost', null, null, 'd'), mk('new', null, 6, 'e'), mk('dropped', -9, 12, 'f'), mk('climbed', 8, 2, 'g')]).map((x) => x.detail.phrase).join('')
  check('diff: order is lost, dropped (largest first), new, climbed (largest first), steady', o === 'dfcegba', o)
}

/* ---- the ad rule, on a page where Roblox puts an ad first: ads are shown, never counted ---- */
{
  const mkItem = (id, name, ad) => ({ contentGroupType: 'Game', contents: [{ universeId: id, rootPlaceId: id * 10, name, playerCount: 5, totalUpVotes: 9, totalDownVotes: 1, isSponsored: ad }] })
  const saved = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('page2')) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify({ searchResults: [mkItem(1, 'Paid Game', true), mkItem(2, 'Rival', false), mkItem(3, 'Mine', false), mkItem(4, 'Next', false), mkItem(1, 'Paid Game repeat', false), mkItem(5, 'Ad Two', true), mkItem(6, 'Last', false)], nextPageToken: '' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const read = await readPhrase('mocked phrase', { universeId: 3, placeId: 30 }, new AbortController().signal)
    check('ads: two ads set aside, the game is position 2 (not 3 or 4), the repeat of an ad id is ignored', read.position === 2 && read.adsSeen === 2 && read.organic.map((h) => h.name).join(',') === 'Rival,Mine,Next,Last', `${read.position} ${read.organic.map((h) => h.name)}`)
    check('ads: ads keep a null position in the shown order', read.all.filter((h) => h.sponsored).every((h) => h.position === null) && read.all[0].sponsored)
  } finally {
    globalThis.fetch = saved
  }
}

for (const g of Object.keys(GAMES)) if (which === 'all' || which === g) await runGame(g)
{
  const facts = await fetchGameFacts(GAMES.fisch.target.universeId, new AbortController().signal)
  const det = assemblePhrases(facts, null)
  check('no-key path: Fisch from its own facts only, at most 14, no emoji', det.length >= 3 && det.length <= 14 && det.every((d) => !hasEmoji(d.phrase)), det.map((d) => d.phrase).join(' / '))
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
