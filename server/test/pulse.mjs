// Real test of the Pulse Daemon analyzer: it runs against live Roblox (Steal An Egg and Fisch), no mocks for run 1 or the live rerun.
//   node server/test/pulse.mjs [steal|fisch|all]
// After the live runs, SIMULATED-memory scenarios replay the last live responses (recorded below) against a made-up previous
// reading, so each rule can be proven at and just under its threshold without waiting for real regressions.
import { tool } from '../tools/pulse.ts'
import { assess, resetServerWindow, serverStats } from '../tools/pulse-vitals.ts'

const which = process.argv[2] ?? 'all'
const GAMES = {
  steal: { kind: 'roblox-game', universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' },
  fisch: { kind: 'roblox-game', universeId: 0, placeId: 16732694052, name: 'Fisch' },
}

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

/* Roblox traffic: live, recorded (so a replay needs no new requests), replayed, or live with the server list emptied. */
const realFetch = globalThis.fetch
let mode = 'live'
let calls = 0
const recorded = new Map()
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (!/roblox\.com/.test(u)) return realFetch(url, init)
  calls++
  if (mode === 'replay') {
    const hit = recorded.get(u)
    if (!hit) throw new Error('replay miss ' + u)
    return new Response(hit.body, { status: hit.status, headers: { 'content-type': 'application/json' } })
  }
  if (mode === 'noservers' && /servers\/Public/.test(u)) return new Response(JSON.stringify({ previousPageCursor: null, nextPageCursor: null, data: [] }), { status: 200 })
  const res = await realFetch(url, init)
  recorded.set(u, { body: await res.clone().text(), status: res.status })
  return res
}

async function run(target, store, now = new Date()) {
  if (mode !== 'live') resetServerWindow()
  const events = []
  const before = calls
  const t0 = Date.now()
  const ctx = {
    tool: 'pulse-daemon',
    target,
    trigger: 'user',
    runId: 'test-run',
    daemonId: 'test-daemon',
    now,
    signal: new AbortController().signal,
    step: (id, label, state, detail) => events.push({ type: 'step', id, label, state, detail }),
    summary: (summary) => events.push({ type: 'summary', summary }),
    finding: (f) => events.push({ type: 'finding', finding: f }),
    llm: { json: async () => { throw new Error('Pulse needs no LLM') } },
    secrets: { get: () => null, has: () => false },
    memory: {
      get: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : undefined),
      set: (k, v) => void (store[k] = JSON.parse(JSON.stringify(v))),
    },
    previous: [],
  }
  await tool.analyze(ctx)
  const findings = events.filter((e) => e.type === 'finding').map((e) => e.finding)
  return { events, findings, summary: events.find((e) => e.type === 'summary').summary, requests: calls - before, ms: Date.now() - t0, by: Object.fromEntries(findings.map((f) => [f.detail.vital, f])) }
}

const BAD_CHARS = /[—–·]/
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
const RANK = { regressed: 0, improved: 1, steady: 2, first: 3 }
const sortedOk = (findings) => findings.every((f, i) => i === 0 || RANK[findings[i - 1].detail.state] <= RANK[f.detail.state])
const overall = (r) => r.summary.items.find((i) => i.label === 'Overall').value
const finiteOrNull = (x) => x === null || (typeof x === 'number' && Number.isFinite(x))

function show(label, r) {
  console.log(`\n--- ${label}: ${r.findings.length} findings, ${r.requests} Roblox requests, ${(r.ms / 1000).toFixed(1)}s ---`)
  console.log('summary:', r.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '), '| sort:', r.summary.sortLabel)
  for (const f of r.findings) console.log(`[${f.badge.label}] ${f.title}: now ${f.meta[0].value}, before ${f.meta[1].value}, change ${f.meta[2].value}, read ${f.meta[3].value}, status ${f.status.label}\n    ${f.snippet[0].text}`)
}

/* ---------------------------------------------------------------- live runs */
async function live(key, rerun) {
  const target = GAMES[key]
  const label = target.name
  const store = {}
  console.log(`\n===== ${label} (live) =====`)
  const r1 = await run(target, store)
  show(`${label} run 1`, r1)
  const readings1 = store.readings
  check(`${label}: run 1 stored exactly one reading`, Array.isArray(readings1) && readings1.length === 1)
  const rd = readings1[0]
  check(`${label}: all six vitals present`, ['players', 'likes', 'fps', 'ping', 'fill', 'update'].every((v) => r1.by[v]) && r1.findings.length === 6)
  check(`${label}: stored numbers are finite or null`, Object.entries(rd).every(([k, v]) => ['t', 'updated', 'created'].includes(k) || finiteOrNull(v)))
  check(`${label}: players and visits are real numbers`, rd.players >= 0 && rd.visits > 0 && rd.favourites > 0)
  check(`${label}: server sample has servers and no zero stats`, rd.sampled > 0 && rd.sampled <= 300 && rd.fpsMedian > 0 && rd.pingP90 > 0 && rd.fill > 0, `(${rd.sampled} servers: ${rd.fullest} fullest, ${rd.emptiest} emptiest, fps ${rd.fpsMedian}, p90 ${rd.pingP90})`)
  check(`${label}: sample is both fullest and emptiest ordering`, rd.fullest + rd.emptiest === rd.sampled && rd.fullest > 0 && rd.emptiest > 0)
  check(`${label}: like ratio equals up/(up+down) of the votes fetched`, Math.abs(rd.ratio - (rd.up / (rd.up + rd.down)) * 100) < 0.0006, `(${rd.up} up, ${rd.down} down, ${rd.ratio})`)
  mode = 'live'
  const votes = await (await realFetch(`https://games.roblox.com/v1/games/votes?universeIds=${target.universeId || 5750914919}`)).json()
  const v = votes.data[0]
  check(`${label}: like ratio matches an independent votes fetch`, Math.abs(rd.ratio - (v.upVotes / (v.upVotes + v.downVotes)) * 100) < 0.1, `(${(v.upVotes / (v.upVotes + v.downVotes) * 100).toFixed(3)})`)
  check(`${label}: run 1 every row is First read and nothing is flagged`, r1.findings.every((f) => f.badge.label === 'First read' && f.detail.state === 'first' && f.status.label !== 'Flagged') && !r1.findings.some((f) => f.detail.updatedNote))
  check(`${label}: run 1 Overall is First read, Regressed vitals reads 0`, overall(r1) === 'First read' && r1.summary.items.find((i) => i.label === 'Regressed vitals').value === '0')
  check(`${label}: summary items and sort label`, ['Overall', 'Players now', 'Like ratio', 'Median fps', 'Regressed vitals'].every((l, i) => r1.summary.items[i]?.label === l) && r1.summary.sortLabel === 'Regressions first')
  check(`${label}: summary note says server numbers are a sample, private servers excluded`, r1.summary.notes.some((n) => /sample/.test(n) && /not every server/.test(n) && /private servers are not included/.test(n)))
  check(`${label}: every finding has a spark-less first row and a detail of kind pulse`, r1.findings.every((f) => f.detail.kind === 'pulse' && f.spark === undefined && f.detail.history.length === 1))
  check(`${label}: no em dash, en dash or middle dot in any generated string`, !strings([r1.events]).some((s) => BAD_CHARS.test(s)))
  check(`${label}: under 25 Roblox requests per run`, r1.requests < 25, `(${r1.requests})`)

  if (rerun) {
    const r2 = await run(target, store, new Date(Date.now() + 5 * 60_000))
    show(`${label} live rerun (real memory, 5 minutes later)`, r2)
    check(`${label}: live rerun compares (no First read left)`, r2.findings.every((f) => f.detail.state !== 'first') && r2.findings.every((f) => f.detail.previousAt === rd.t))
    check(`${label}: live rerun players not flagged (readings 5 minutes apart)`, r2.by.players.detail.state === 'steady' && /Not compared/.test(r2.by.players.meta[2].value))
    check(`${label}: live rerun stored two readings and has labelled sparklines`, store.readings.length === 2 && r2.findings.every((f) => f.spark && f.spark.data.length === 2 && f.spark.label && f.detail.history.length === 2))
    check(`${label}: live rerun sorted Regressed, Improved, Steady, First read`, sortedOk(r2.findings))
    check(`${label}: live rerun under 25 Roblox requests`, r2.requests < 25, `(${r2.requests})`)
  }
  return { target, label, base: store.readings[store.readings.length - 1] }
}

/* --------------------------------------------------- simulated memory, end to end */
async function simulated(g) {
  const { target, label, base } = g
  const now = new Date()
  const prevAt = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString()
  const seed = (over, hours = 12) => ({ readings: [{ ...base, t: prevAt(hours), ...over }] })
  mode = 'replay'
  console.log(`\n===== ${label} (SIMULATED memory over the last live responses) =====`)

  const bad = await run(target, seed({ players: base.players * 2, ratio: base.ratio + 5, fpsMedian: base.fpsMedian / 0.8, pingP90: base.pingP90 / 1.5, updated: '2020-01-01T00:00:00.000Z' }), now)
  show(`${label} SIMULATED four regressions after an update`, bad)
  check(`${label} SIMULATED: four regressions + update since: Overall is Sick`, overall(bad) === 'Sick' && bad.summary.items.find((i) => i.label === 'Regressed vitals').value === '4')
  check(`${label} SIMULATED: regressed rows come first`, sortedOk(bad.findings) && bad.findings.slice(0, 4).every((f) => f.badge.label === 'Regressed' && f.status.label === 'Flagged'))
  check(`${label} SIMULATED: each flag names its numbers and the gap`, bad.findings.slice(0, 4).every((f) => /12 hours/.test(f.snippet[0].text) && /\d/.test(f.snippet[0].text)))
  check(`${label} SIMULATED: regression right after the update is called out`, bad.findings.slice(0, 4).every((f) => /after the update/.test(f.snippet[0].text) && /updated .+ ago/.test(f.detail.updatedNote ?? '')))
  check(`${label} SIMULATED: update row calls out the update`, bad.by.update.status.label === 'Updated' && /was updated .+ ago/.test(bad.by.update.snippet[0].text) && bad.by.update.meta[2].value === 'Updated since')
  check(`${label} SIMULATED: player flag text says why readings 3 hours apart`, /3 hours apart/.test(bad.by.players.detail.rule) && /at least 3 hours/.test(bad.by.players.detail.verdict))

  const young = await run(target, seed({ players: base.players * 2 }, 2), now)
  show(`${label} SIMULATED players -50% but 2 hours apart`, young)
  check(`${label} SIMULATED: players -50% under 3 hours apart does not flag and says so`, young.by.players.detail.state === 'steady' && young.by.players.meta[2].value === 'Not compared' && /under 3 hours apart/.test(young.by.players.snippet[0].text) && overall(young) === 'Healthy')
  check(`${label} SIMULATED: no update since the previous reading is not called out`, young.by.update.status.label !== 'Updated' && young.by.update.meta[2].value === 'No update since' && young.findings.every((f) => f.detail.updatedNote === null))

  const watch = await run(target, seed({ ratio: base.ratio + 3 }), now)
  check(`${label} SIMULATED: one regression (like ratio -3 points) is Watch`, overall(watch) === 'Watch' && watch.by.likes.detail.state === 'regressed' && watch.findings[0].detail.vital === 'likes')

  const good = await run(target, seed({ players: base.players * 0.5, ratio: base.ratio - 3, fpsMedian: base.fpsMedian * 0.8, pingP90: base.pingP90 * 1.5 }), now)
  show(`${label} SIMULATED four improvements`, good)
  check(`${label} SIMULATED: four improvements show Improved first and Overall Healthy`, good.findings.slice(0, 4).every((f) => f.badge.label === 'Improved' && f.badge.tone === 'live') && overall(good) === 'Healthy' && good.summary.items.find((i) => i.label === 'Regressed vitals').value === '0')
  check(`${label} SIMULATED: fill and update are Steady and sit after Improved`, good.by.fill.detail.state === 'steady' && good.by.update.detail.state === 'steady' && sortedOk(good.findings))

  const capped = await run(target, { readings: Array.from({ length: 12 }, (_, i) => ({ ...base, t: prevAt(12 * (12 - i)) })) }, now)
  check(`${label} SIMULATED: memory keeps only the last 12 readings`, capped.by.players.detail.history.length === 12 && capped.by.players.detail.history[11].t === now.toISOString())
  check(`${label} SIMULATED: replay made no new Roblox requests beyond the recorded set`, bad.requests < 25)
  mode = 'live'
}

/* ---------------------------------------------- pure rule boundaries (SIMULATED readings) */
function boundaries() {
  console.log('\n===== rule thresholds, exact (SIMULATED readings through assess) =====')
  const now = new Date('2026-10-27T12:00:00.000Z')
  const mk = (over = {}, hoursAgo = 12) => ({
    t: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
    players: 1000, visits: 5_000_000, favourites: 90_000, up: 900, down: 100, ratio: 90, fpsMedian: 60, fpsUnder30: 0, pingMedian: 80, pingP90: 100,
    fill: 50, sampled: 300, fullest: 200, emptiest: 100, updated: '2026-10-20T00:00:00.000Z', created: '2024-01-01T00:00:00.000Z', ...over,
  })
  const state = (prev, cur, vital) => assess(prev, cur, now).assessments.find((a) => a.vital === vital)
  const p = mk()
  const t = (name, a, expect) => check(`SIMULATED threshold: ${name}`, a.state === expect, `(got ${a.state}, change ${a.change})`)
  t('players -20% at 12 hours flags', state(p, mk({ players: 800 }, 0), 'players'), 'regressed')
  t('players -19.9% does not flag', state(p, mk({ players: 801 }, 0), 'players'), 'steady')
  t('players -20% exactly 3 hours apart flags', state(mk({}, 3), mk({ players: 800 }, 0), 'players'), 'regressed')
  t('players -20% 2 hours 59 minutes apart does not flag', state(mk({ t: new Date(now.getTime() - 179 * 60_000).toISOString() }), mk({ players: 800 }), 'players'), 'steady')
  t('players -50% 2 hours apart does not flag', state(mk({}, 2), mk({ players: 500 }), 'players'), 'steady')
  t('players +20% improves', state(p, mk({ players: 1200 }), 'players'), 'improved')
  t('players +19.9% is steady', state(p, mk({ players: 1199 }), 'players'), 'steady')
  t('like ratio -2 points flags', state(p, mk({ ratio: 88 }), 'likes'), 'regressed')
  t('like ratio -1.9 points does not flag', state(p, mk({ ratio: 88.1 }), 'likes'), 'steady')
  t('like ratio +2 points improves', state(p, mk({ ratio: 92 }), 'likes'), 'improved')
  t('median fps -10% flags', state(p, mk({ fpsMedian: 54 }), 'fps'), 'regressed')
  t('median fps -9.8% does not flag', state(p, mk({ fpsMedian: 54.1 }), 'fps'), 'steady')
  t('median fps +10% improves', state(p, mk({ fpsMedian: 66 }), 'fps'), 'improved')
  t('ping p90 +25% flags', state(p, mk({ pingP90: 125 }), 'ping'), 'regressed')
  t('ping p90 +24% does not flag', state(p, mk({ pingP90: 124 }), 'ping'), 'steady')
  t('ping p90 -25% improves', state(p, mk({ pingP90: 75 }), 'ping'), 'improved')
  t('ping median rising alone does not flag', state(p, mk({ pingMedian: 400 }), 'ping'), 'steady')
  t('fill never regresses', state(p, mk({ fill: 1 }), 'fill'), 'steady')
  const upd = assess(p, mk({ updated: '2026-10-27T09:00:00.000Z' }), now)
  check('SIMULATED threshold: update since the last reading is called out as "updated 3 hours ago"', upd.assessments.find((a) => a.vital === 'update').updatedNote === 'updated 3 hours ago' && upd.assessments.every((a) => a.updatedNote === 'updated 3 hours ago'))
  check('SIMULATED threshold: no update since means no call-out', assess(p, mk(), now).assessments.every((a) => a.updatedNote === null))
  const reg = (n) => assess(p, mk({ players: n >= 1 ? 500 : 1000, ratio: n >= 2 ? 80 : 90, fpsMedian: 60 }), now)
  check('Overall rule: 0 regressed is Healthy, 1 is Watch, 2 is Sick', reg(0).overall === 'Healthy' && reg(1).overall === 'Watch' && reg(2).overall === 'Sick' && reg(2).regressed === 2)
  check('Overall rule: first run is First read and flags nothing', assess(null, mk({ players: 1 }), now).overall === 'First read' && assess(null, mk(), now).assessments.every((a) => a.state === 'first' && !a.flagged))
  const none = serverStats([])
  check('no public servers: server stats are null, not zero', none.fpsMedian === null && none.pingP90 === null && none.fill === null && none.fpsUnder30 === null)
  const na = assess(null, mk({ fpsMedian: null, fpsUnder30: null, pingMedian: null, pingP90: null, fill: null, sampled: 0, fullest: 0, emptiest: 0 }), now)
  check('no public servers: rows say Not available', ['fps', 'ping', 'fill'].every((v) => na.assessments.find((a) => a.vital === v).now === 'Not available'))
  check('server stats: median fps of three servers', serverStats([{ id: 'a', maxPlayers: 10, playing: 5, fps: 20, ping: 10 }, { id: 'b', maxPlayers: 10, playing: 10, fps: 60, ping: 30 }, { id: 'c', maxPlayers: 10, playing: 0, fps: 40, ping: 20 }]).fpsMedian === 40)
}

boundaries()
const keys = which === 'all' ? ['steal', 'fisch'] : [which]
const lives = []
for (const [i, k] of keys.entries()) lives.push(await live(k, i === 0))
for (const g of lives) await simulated(g)

/* A game with no public servers (the server list emptied for this run only). */
{
  const g = lives[0]
  mode = 'noservers'
  console.log('\n===== no public servers (server list emptied for this run) =====')
  const store = {}
  const r1 = await run(g.target, store)
  show('no servers, run 1', r1)
  check('no public servers: server vitals are Not available and never zero', ['fps', 'ping', 'fill'].every((v) => r1.by[v].meta[0].value === 'Not available' && !/^0\b/.test(r1.by[v].meta[0].value)) && r1.summary.items.find((i) => i.label === 'Median fps').value === 'Not available')
  check('no public servers: stored sample is null, not zeros', store.readings[0].sampled === 0 && store.readings[0].fpsMedian === null && store.readings[0].pingP90 === null && store.readings[0].fill === null)
  check('no public servers: detail has no sample line and players still read', r1.by.fps.detail.sample === null && r1.by.players.detail.now !== 'Not available')
  mode = 'live'
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
