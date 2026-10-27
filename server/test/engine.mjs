// Standalone checks of the server backbone (store, credits, secrets, run engine, daemons, scheduler, routes).
//   node server/test/engine.mjs
// It boots the engine in this process against temp data dirs with FAKE analyzers injected (server/test/fake-analyzers.ts)
// and serves engine.handle on an ephemeral port. No network, no real key, no browser.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from '../engine.ts'
import { fakeAnalyzers } from './fake-analyzers.ts'

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 8000, step = 25) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(step)
  }
  return false
}

// Everything the server logs is captured so we can prove no secret reaches a log. Set VERBOSE=1 to see it.
const logs = []
const print = console.log.bind(console)
for (const k of ['log', 'error', 'warn']) {
  const orig = console[k].bind(console)
  console[k] = (...a) => {
    const line = a.map(String).join(' ')
    if (/^(PASS|FAIL)  /.test(line) || line.startsWith('\n')) return print(line)
    logs.push(line)
    if (process.env.VERBOSE) orig(...a)
  }
}

// Fake key-shaped strings are assembled at run time so no key literal sits in this file.
const PFX = ['sk', 'or', ''].join('-')
const LEAK = PFX + 'abcdefghijklmnop'
const SECRET = PFX + 'SECRETVALUE0123456789abcdef'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-test-'))
const bodies = [] // every API response body, for the "no secret in any response" check

async function boot(dir, opts = {}) {
  const engine = createEngine({
    dataDir: dir,
    env: (n) => opts.env?.[n] ?? '',
    analyzers: fakeAnalyzers,
    tickMs: opts.tickMs ?? 3_600_000,
    minIntervalHours: 0.0005,
    maxConcurrent: opts.maxConcurrent,
    describe: async (t) => ({ title: t.name, image: null }),
  })
  const server = http.createServer(async (req, res) => {
    if (!(await engine.handle(req, res))) {
      res.statusCode = 404
      res.end('{}')
    }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  if (opts.start !== false) engine.start()
  return {
    engine,
    base,
    async close() {
      await engine.stop()
      server.closeAllConnections?.()
      await new Promise((r) => server.close(r))
    },
  }
}

const api = (base) => async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await r.text()
  bodies.push(text)
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: r.status, json, text, headers: r.headers }
}

async function readRun(base, runId, { abortAfter } = {}) {
  const ac = new AbortController()
  if (abortAfter) setTimeout(() => ac.abort(), abortAfter)
  const events = []
  let blank = 0
  const r = await fetch(`${base}/api/runs/${runId}/events`, { signal: ac.signal })
  const headers = r.headers
  if (!r.ok) return { status: r.status, events, headers, body: await r.json().catch(() => null), blank }
  const dec = new TextDecoder()
  let buf = ''
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        line.trim() ? events.push(JSON.parse(line)) : blank++
      }
    }
  } catch {
    /* aborted */
  }
  return { status: r.status, events, headers, blank }
}

const game = (name, placeId) => ({ kind: 'roblox-game', universeId: placeId, placeId, name })
const types = (events) => events.map((e) => e.type)
const idle = (x) => x.engine.runs.idle()

// ======================================================================= main engine
const dir = path.join(tmp, 'main')
const A = await boot(dir)
const call = api(A.base)

// ---- credits start balances and routes
{
  const c = await call('GET', '/api/credits')
  check('credits: starting balances 10,000 thumbnail / 5,000 others', c.json.balances['thumbnail-daemon'] === 10000 && c.json.balances['hack-daemon'] === 5000 && c.json.balances['creator-dox'] === 5000, JSON.stringify(c.json.balances))
  check('credits: costs 250 per variant, 1500 hack/dmca, 1000 others', c.json.costs['thumbnail-daemon'] === 250 && c.json.costs['hack-daemon'] === 1500 && c.json.costs['dmca-daemon'] === 1500 && c.json.costs['discord-daemon'] === 1000 && c.json.costs['description-daemon'] === 1000 && c.json.costs['creator-dox'] === 1000)
  check('credits: topUps 5000 thumbnail / 2500 others', c.json.topUps['thumbnail-daemon'] === 5000 && c.json.topUps['hack-daemon'] === 2500)
  check('credits: charge never goes negative and is atomic', A.engine.credits.charge('hack-daemon', 5001) === false && A.engine.credits.balance('hack-daemon') === 5000)
  const t = await call('POST', '/api/credits/topup', { tool: 'description-daemon' })
  check('credits: topup adds 2500 and returns CreditsResponse', t.status === 200 && t.json.balances['description-daemon'] === 7500 && !!t.json.costs && !!t.json.topUps)
  check('credits: topup rejects unknown tool', (await call('POST', '/api/credits/topup', { tool: 'nope' })).status === 400)
  A.engine.credits.charge('description-daemon', 2500)
}

// ---- lifecycle, replay ordering, charge, isNew
let hack // daemon record
let run1
{
  const created = await call('POST', '/api/daemons', { tool: 'hack-daemon', target: game('wait:400', 11) })
  check('create: 201 with daemon and runId', created.status === 201 && !!created.json.daemon?.id && typeof created.json.runId === 'string')
  hack = created.json.daemon
  run1 = created.json.runId
  check('create: defaults to 12 hour interval, enabled, nextRunAt set', hack.intervalHours === 12 && hack.enabled === true && !!hack.nextRunAt && hack.title === 'wait:400')
  check('credits: charged 1500 when the run starts', A.engine.credits.balance('hack-daemon') === 3500)
  check('create: activeRunId is the run', created.json.daemon.activeRunId === run1)

  // tail live from mid-run: replay what exists, then follow to the end
  await sleep(120)
  const live = await readRun(A.base, run1)
  check('events: ndjson headers', live.status === 200 && /application\/x-ndjson/.test(live.headers.get('content-type')) && live.headers.get('cache-control') === 'no-cache' && live.headers.get('x-accel-buffering') === 'no')
  const ty = types(live.events)
  check('events: order start, step, ... summary, finding, end', ty[0] === 'start' && ty.at(-1) === 'end' && ty.indexOf('summary') > ty.indexOf('step') && ty.indexOf('finding') > ty.indexOf('summary'), ty.join(','))
  check('events: exactly one end, 2 findings, step times non-decreasing and >= 0', ty.filter((x) => x === 'end').length === 1 && ty.filter((x) => x === 'finding').length === 2 && live.events.filter((e) => e.type === 'step').every((e, i, a) => e.at >= 0 && (i === 0 || e.at >= a[i - 1].at)))
  const start = live.events[0]
  const end = live.events.at(-1)
  check('events: start carries cost 1500, tool and daemon', start.cost === 1500 && start.tool === 'hack-daemon' && start.daemonId === hack.id && start.runId === run1)
  check('events: end done, 2 findings, 0 new on the first run, 0 refunded', end.status === 'done' && end.findings === 2 && end.newFindings === 0 && end.refunded === 0 && end.durationMs >= 300)
  check('events: first-run findings have isNew false', live.events.filter((e) => e.type === 'finding').every((e) => e.finding.isNew === false))
  const replay = await readRun(A.base, run1)
  check('replay after end is identical', JSON.stringify(replay.events) === JSON.stringify(live.events))
  check('credits: no refund after success', A.engine.credits.balance('hack-daemon') === 3500)
  const unknown = await readRun(A.base, 'does-not-exist')
  check('events: unknown run is a 404 JSON', unknown.status === 404 && unknown.body?.ok === false)

  // second run: f3 appears
  const r2 = await call('POST', `/api/daemons/${hack.id}/run`)
  check('run now: returns runId', r2.status === 200 && typeof r2.json.runId === 'string' && r2.json.runId !== run1)
  const second = await readRun(A.base, r2.json.runId)
  const f = second.events.filter((e) => e.type === 'finding').map((e) => [e.finding.id, e.finding.isNew])
  check('isNew: second run marks only the id missing from the previous run', JSON.stringify(f) === JSON.stringify([['f1', false], ['f2', false], ['f3', true]]), JSON.stringify(f))
  check('isNew: end.newFindings is 1', second.events.at(-1).newFindings === 1 && second.events.at(-1).findings === 3)
  const detail = await call('GET', `/api/daemons/${hack.id}`)
  check('detail: history newest first with both runs, latest = newest run events', detail.json.history.length === 2 && detail.json.history[0].runId === r2.json.runId && detail.json.latest.runId === r2.json.runId && detail.json.latest.events.length === second.events.length)
  check('detail: counters and last', detail.json.runs === 2 && detail.json.last?.status === 'done' && !!detail.json.lastRunAt && !detail.json.activeRunId)
  check('detail: nextRunAt = lastRunAt + 12h', Math.abs(Date.parse(detail.json.nextRunAt) - Date.parse(detail.json.lastRunAt) - 12 * 3600_000) < 5)
  check('credits: two runs charged 3000, balance 2000', A.engine.credits.balance('hack-daemon') === 2000)
}

// ---- one active run, duplicates, validation
{
  const d = await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('wait:700', 21), intervalHours: 6 })
  const again = await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('wait:700', 21) })
  check('same tool+target returns the existing daemon and the active run', again.status === 200 && again.json.daemon.id === d.json.daemon.id && again.json.runId === d.json.runId)
  check('one active run: POST /run while active returns that run', (await call('POST', `/api/daemons/${d.json.daemon.id}/run`)).json.runId === d.json.runId)
  check('thumbnail watcher run costs nothing', A.engine.credits.balance('thumbnail-daemon') === 10000)
  await idle(A)
  const again2 = await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('wait:700', 21) })
  check('same tool+target after the run ended starts a new run', again2.status === 200 && again2.json.daemon.id === d.json.daemon.id && again2.json.runId !== d.json.runId)
  await idle(A)
  const list = await call('GET', '/api/daemons?tool=thumbnail-daemon')
  check('list: filter by tool', list.json.daemons.length === 1 && list.json.daemons[0].tool === 'thumbnail-daemon' && (await call('GET', '/api/daemons')).json.daemons.length === 2)
  check('list: unknown tool 400', (await call('GET', '/api/daemons?tool=x')).status === 400)
  check('validate: wrong target kind', (await call('POST', '/api/daemons', { tool: 'discord-daemon', target: game('x', 5) })).status === 400)
  check('validate: unknown tool', (await call('POST', '/api/daemons', { tool: 'x', target: game('x', 5) })).status === 400)
  check('validate: interval below 0.001', (await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('x', 6), intervalHours: 0.0001 })).status === 400)
  check('validate: interval above 168', (await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('x', 6), intervalHours: 169 })).status === 400)
  check('validate: missing body', (await call('POST', '/api/daemons', undefined)).status === 400)
  check('validate: discord target accepted', (await call('POST', '/api/daemons', { tool: 'discord-daemon', target: { kind: 'discord-server', invite: 'abc-def', guildId: '123456', name: 'Guild' } })).status === 201)
  await idle(A)
  const patched = await call('PATCH', `/api/daemons/${d.json.daemon.id}`, { intervalHours: 1 })
  check('patch: interval recomputes nextRunAt from lastRunAt', patched.status === 200 && patched.json.intervalHours === 1 && Math.abs(Date.parse(patched.json.nextRunAt) - Date.parse(patched.json.lastRunAt) - 3600_000) < 5)
  const paused = await call('PATCH', `/api/daemons/${d.json.daemon.id}`, { enabled: false })
  check('patch: pause removes nextRunAt', paused.json.enabled === false && paused.json.nextRunAt === undefined)
  check('patch: bad interval 400, unknown daemon 404', (await call('PATCH', `/api/daemons/${d.json.daemon.id}`, { intervalHours: 999 })).status === 400 && (await call('PATCH', '/api/daemons/nope', { enabled: true })).status === 404)
  const resumed = await call('PATCH', `/api/daemons/${d.json.daemon.id}`, { enabled: true })
  check('patch: resume sets nextRunAt', resumed.json.enabled === true && !!resumed.json.nextRunAt)
  check('405 on a wrong method', (await call('PUT', '/api/daemons')).status === 405)
}

// ---- failures and refunds
{
  const before = A.engine.credits.balance('hack-daemon')
  const z = await call('POST', '/api/daemons', { tool: 'hack-daemon', target: game('fail-zero', 31) })
  const ev = await readRun(A.base, z.json.runId)
  const ty = types(ev.events)
  check('failed run: error event (with action) precedes end failed', ty.at(-1) === 'end' && ty.at(-2) === 'error' && ev.events.at(-2).code === 'upstream' && ev.events.at(-2).action?.kind === 'retry' && ev.events.at(-1).status === 'failed')
  check('failed with zero findings: refunded, end.refunded = cost, balance restored', ev.events.at(-1).refunded === 1500 && A.engine.credits.balance('hack-daemon') === before)
  const p = await call('POST', '/api/daemons', { tool: 'hack-daemon', target: game('fail-partial', 32) })
  const pe = await readRun(A.base, p.json.runId)
  check('failed with findings: no refund', pe.events.at(-1).status === 'failed' && pe.events.at(-1).findings === 1 && pe.events.at(-1).refunded === 0 && A.engine.credits.balance('hack-daemon') === before - 1500)
  const c = await call('POST', '/api/daemons', { tool: 'description-daemon', target: game('crash', 33) })
  const ce = await readRun(A.base, c.json.runId)
  const err = ce.events.find((e) => e.type === 'error')
  check('crash: error code internal with the generic message', err?.code === 'internal' && err.message === 'This run hit an unexpected error. Try again.', err?.message)
  check('crash: no key in the stream, key redacted in the server log', !JSON.stringify(ce.events).includes(PFX) && !logs.join('\n').includes(LEAK) && logs.some((l) => l.includes('analyzer failed')))
  check('crash: refunded (zero findings)', ce.events.at(-1).refunded === 1000)
  const det = await call('GET', `/api/daemons/${c.json.daemon.id}`)
  check('failed run summary carries the error text', det.json.history[0].status === 'failed' && typeof det.json.history[0].error === 'string')
}

// ---- credits shortage: 402, no daemon; scheduled shortage records a failed run and keeps the schedule
{
  const bal = A.engine.credits.balance('dmca-daemon')
  A.engine.credits.charge('dmca-daemon', bal - 100)
  const n = (await call('GET', '/api/daemons')).json.daemons.length
  const r = await call('POST', '/api/daemons', { tool: 'dmca-daemon', target: game('wait:50', 41) })
  check('shortage: 402 {ok:false, code:credits, message, needed, balance}', r.status === 402 && r.json.ok === false && r.json.code === 'credits' && r.json.needed === 1500 && r.json.balance === 100 && /1,500/.test(r.json.message) && /100/.test(r.json.message), r.text)
  check('shortage: no daemon was created and nothing was charged', (await call('GET', '/api/daemons')).json.daemons.length === n && A.engine.credits.balance('dmca-daemon') === 100)
  // a daemon created while affordable, then starved
  A.engine.credits.topUp('dmca-daemon')
  const ok = await call('POST', '/api/daemons', { tool: 'dmca-daemon', target: game('wait:50', 42), intervalHours: 0.001 })
  await idle(A)
  A.engine.credits.charge('dmca-daemon', A.engine.credits.balance('dmca-daemon'))
  const run402 = await call('POST', `/api/daemons/${ok.json.daemon.id}/run`)
  check('shortage: POST /run is 402 too', run402.status === 402 && run402.json.code === 'credits')
  await sleep(3700) // 0.001 h = 3.6 s until the schedule is due
  const started = A.engine.daemons.tick()
  check('scheduler: a due daemon is started on tick', started >= 1)
  const d2 = await call('GET', `/api/daemons/${ok.json.daemon.id}`)
  const h = d2.json.history[0]
  check('scheduled shortage: failed run recorded with credits error, trigger schedule, nothing charged', h.status === 'failed' && h.trigger === 'schedule' && /credits/.test(h.error ?? '') && A.engine.credits.balance('dmca-daemon') === 0, JSON.stringify(h))
  const ev = d2.json.latest.events
  check('scheduled shortage: events are start + error credits (+ end), action add-credits', ev[0].type === 'start' && ev[1].type === 'error' && ev[1].code === 'credits' && ev[1].action?.kind === 'add-credits' && ev[2]?.type === 'end')
  check('scheduled shortage: daemon keeps its schedule (enabled, nextRunAt in the future)', d2.json.enabled === true && Date.parse(d2.json.nextRunAt) > Date.now() - 50 && d2.json.last?.status === 'failed')
}

// ---- concurrency cap of 3
{
  const ids = []
  for (let i = 0; i < 5; i++) ids.push((await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('wait:900', 100 + i) })).json)
  const counts = A.engine.runs.counts()
  check('concurrency: at most 3 running, the rest queued', counts.running === 3 && counts.queued === 2, JSON.stringify(counts))
  const statuses = []
  for (const x of ids) statuses.push((await call('GET', `/api/daemons/${x.daemon.id}`)).json.history[0].status)
  check('concurrency: queued runs report status queued', statuses.filter((s) => s === 'queued').length === 2 && statuses.filter((s) => s === 'running').length === 3, statuses.join(','))
  const qev = await readRun(A.base, ids[4].runId)
  check('concurrency: a queued run still streams to its end', qev.events.at(-1)?.type === 'end' && qev.events.at(-1).status === 'done')
  await idle(A)
  check('concurrency: all five finish', (await Promise.all(ids.map(async (x) => (await call('GET', `/api/daemons/${x.daemon.id}`)).json.last?.status))).every((s) => s === 'done'))
  for (const x of ids) await call('DELETE', `/api/daemons/${x.daemon.id}`)
}

// ---- client disconnect keeps the run going
{
  const x = await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('wait:700', 51) })
  const partial = await readRun(A.base, x.json.runId, { abortAfter: 150 })
  check('disconnect: client abort returns a partial stream', partial.events.length >= 1 && partial.events.at(-1).type !== 'end')
  await idle(A)
  const det = await call('GET', `/api/daemons/${x.json.daemon.id}`)
  check('disconnect: the run still finished on the server', det.json.last?.status === 'done')
  await call('DELETE', `/api/daemons/${x.json.daemon.id}`)
}

// ---- delete aborts the active run (and refunds an empty one), removes runs and memory
{
  const before = A.engine.credits.balance('creator-dox')
  const x = await call('POST', '/api/daemons', { tool: 'creator-dox', target: game('slow', 61) })
  await until(() => A.engine.runs.meta(x.json.runId)?.status === 'running', 2000)
  check('delete: run is active and charged', A.engine.credits.balance('creator-dox') === before - 1000)
  const reader = readRun(A.base, x.json.runId)
  const t0 = Date.now()
  const del = await call('DELETE', `/api/daemons/${x.json.daemon.id}`)
  const ev = await reader
  check('delete: returns promptly (the 30 s run was aborted)', del.status === 200 && Date.now() - t0 < 3000, `${Date.now() - t0} ms`)
  check('delete: the live stream ended with error aborted then end failed', ev.events.at(-2)?.code === 'aborted' && ev.events.at(-1)?.status === 'failed')
  check('delete: aborted empty run refunded', A.engine.credits.balance('creator-dox') === before)
  check('delete: daemon, run and memory files are gone', (await call('GET', `/api/daemons/${x.json.daemon.id}`)).status === 404 && (await readRun(A.base, x.json.runId)).status === 404 && !fs.existsSync(path.join(dir, 'runs', `${x.json.runId}.json`)) && !fs.existsSync(path.join(dir, 'memory', `${x.json.daemon.id}.json`)))
  check('delete: unknown daemon is 404', (await call('DELETE', `/api/daemons/${x.json.daemon.id}`)).status === 404)
}

// ---- keep the 30 newest runs
{
  const x = await call('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('prune', 71) })
  await idle(A)
  for (let i = 0; i < 33; i++) {
    const r = await call('POST', `/api/daemons/${x.json.daemon.id}/run`)
    await readRun(A.base, r.json.runId)
  }
  await idle(A)
  const det = await call('GET', `/api/daemons/${x.json.daemon.id}`)
  const files = fs.readdirSync(path.join(dir, 'runs')).filter((f) => det.json.history.some((h) => f === `${h.runId}.json`))
  check('retention: history capped at 30, files kept for exactly those', det.json.history.length === 30 && files.length === 30 && det.json.runs === 34, `history=${det.json.history.length} files=${files.length} runs=${det.json.runs}`)
  check('retention: older run files were deleted from disk', fs.readdirSync(path.join(dir, 'runs')).length < 30 + 12)
  await call('DELETE', `/api/daemons/${x.json.daemon.id}`)
}

// ---- secrets
{
  check('secrets: GET lists presence only, all false at first', JSON.stringify((await call('GET', '/api/secrets')).json) === JSON.stringify({ secrets: { 'discord-bot-token': false, 'openrouter-key': false, 'gemini-key': false, 'roblox-open-cloud-key': false } }))
  const set = await call('POST', '/api/secrets', { name: 'openrouter-key', value: `  ${SECRET}  ` })
  check('secrets: POST trims and stores', set.status === 200 && set.json.ok === true && A.engine.secrets.get('openrouter-key') === SECRET)
  check('secrets: GET shows true, value never returned', (await call('GET', '/api/secrets')).json.secrets['openrouter-key'] === true && !set.text.includes('SECRETVALUE'))
  await A.engine.store.flush()
  const file = path.join(dir, 'secrets.json')
  check('secrets: file mode is 0600', (fs.statSync(file).mode & 0o777) === 0o600, (fs.statSync(file).mode & 0o777).toString(8))
  check('store: data dir is 0700', (fs.statSync(dir).mode & 0o777) === 0o700, (fs.statSync(dir).mode & 0o777).toString(8))
  check(
    'secrets: unknown name 400, empty 400, whitespace 400, over 512 chars 400, line break 400',
    (await call('POST', '/api/secrets', { name: 'nope', value: 'x' })).status === 400 &&
      (await call('POST', '/api/secrets', { name: 'gemini-key', value: '' })).status === 400 &&
      (await call('POST', '/api/secrets', { name: 'gemini-key', value: '   ' })).status === 400 &&
      (await call('POST', '/api/secrets', { name: 'gemini-key', value: 'a'.repeat(513) })).status === 400 &&
      (await call('POST', '/api/secrets', { name: 'gemini-key', value: 'a\nb' })).status === 400,
  )
  check('secrets: exactly 512 chars accepted', (await call('POST', '/api/secrets', { name: 'gemini-key', value: 'a'.repeat(512) })).status === 200)
  check('keys: a saved openrouter key makes the per-run LLM available', A.engine.makeLlm().available === true)
  check('secrets: scrub removes a stored value from text', !A.engine.secrets.scrub(`boom ${SECRET} boom`).includes('SECRETVALUE'))
  check('secrets: DELETE removes it', (await call('DELETE', '/api/secrets/openrouter-key')).status === 200 && (await call('GET', '/api/secrets')).json.secrets['openrouter-key'] === false && A.engine.makeLlm().available === false)
  await call('DELETE', '/api/secrets/gemini-key')
  check('secrets: DELETE unknown name 400', (await call('DELETE', '/api/secrets/nope')).status === 400)
  check('secrets: no secret value in any API response or any log line', !bodies.join('\n').includes('SECRETVALUE') && !bodies.join('\n').includes('aaaaaaaaaaaaaaaa') && !logs.join('\n').includes('SECRETVALUE'))
}

// ---- store files exist and are valid JSON
{
  await A.engine.store.flush()
  const names = ['daemons.json', 'credits.json', 'secrets.json']
  check('store: collections written as JSON', names.every((n) => { try { JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); return true } catch { return false } }))
  check('store: no temp files left behind', !fs.readdirSync(dir).some((n) => n.endsWith('.tmp')) && !fs.readdirSync(path.join(dir, 'runs')).some((n) => n.endsWith('.tmp')))
  check('store: memory file per daemon (the hack daemon remembers its runs)', JSON.parse(fs.readFileSync(path.join(dir, 'memory', `${hack.id}.json`), 'utf8')).runs === 2)
}

// ---- restart: replay from disk, credits and daemons persist
const mainRunEvents = (await readRun(A.base, run1)).events
const balanceBefore = A.engine.credits.balance('hack-daemon')
await A.close()
{
  const B = await boot(dir, { start: false })
  const cb = api(B.base)
  const list = await cb('GET', '/api/daemons')
  check('restart: daemons come back from disk', list.json.daemons.find((d) => d.id === hack.id)?.runs === 2)
  check('restart: credits persisted', B.engine.credits.balance('hack-daemon') === balanceBefore, `${B.engine.credits.balance('hack-daemon')} vs ${balanceBefore}`)
  const replay = await readRun(B.base, run1)
  check('restart: GET replays the stored events exactly', JSON.stringify(replay.events) === JSON.stringify(mainRunEvents) && replay.events.length > 3)
  const det = await cb('GET', `/api/daemons/${hack.id}`)
  check('restart: detail latest and history survive', det.json.history.length === 2 && det.json.latest?.events.at(-1)?.type === 'end')
  B.engine.credits.topUp('hack-daemon')
  const r3 = await cb('POST', `/api/daemons/${hack.id}/run`)
  const ev3 = await readRun(B.base, r3.json.runId)
  check('restart: previous findings and memory are read from disk (f3 no longer new)', ev3.events.filter((e) => e.type === 'finding').every((e) => e.finding.isNew === false) && ev3.events.at(-1).newFindings === 0)
  await B.close()
}

// ---- crashed run recovery: a run file left as 'running' is closed out and refunded
{
  const d = path.join(tmp, 'crash')
  const E1 = await boot(d, { start: false })
  const x = await api(E1.base)('POST', '/api/daemons', { tool: 'hack-daemon', target: game('slow', 81) })
  await until(() => E1.engine.runs.meta(x.json.runId)?.status === 'running', 2000)
  await E1.engine.store.flush()
  const runFile = path.join(d, 'runs', `${x.json.runId}.json`)
  const snapshot = fs.readFileSync(runFile, 'utf8')
  const creditsFile = fs.readFileSync(path.join(d, 'credits.json'), 'utf8')
  await E1.close() // a clean stop records the run as aborted: put the crash-time files back instead
  fs.writeFileSync(runFile, snapshot)
  fs.writeFileSync(path.join(d, 'credits.json'), creditsFile)
  const E2 = await boot(d, { start: false })
  const ev = await readRun(E2.base, x.json.runId)
  check('recovery: an interrupted run is closed with error + end failed, refunded', ev.events.at(-2)?.code === 'aborted' && ev.events.at(-1)?.status === 'failed' && ev.events.at(-1).refunded === 1500)
  check('recovery: its charge was returned', E2.engine.credits.balance('hack-daemon') === 5000)
  await E2.close()
}

// ---- engine.stop aborts running runs and records them
{
  const d = path.join(tmp, 'stop')
  const E = await boot(d, { start: false })
  const x = await api(E.base)('POST', '/api/daemons', { tool: 'description-daemon', target: game('slow', 91) })
  await until(() => E.engine.runs.meta(x.json.runId)?.status === 'running', 2000)
  await E.close()
  const E2 = await boot(d, { start: false })
  const ev = await readRun(E2.base, x.json.runId)
  check('stop: a running run is recorded as aborted and refunded, the daemon is kept', ev.events.at(-2)?.code === 'aborted' && ev.events.at(-1).refunded === 1000 && E2.engine.credits.balance('description-daemon') === 5000 && E2.engine.daemons.list().length === 1)
  await E2.close()
}

// ---- scheduler fires at intervalHours=0.0005 with a 200 ms tick
const schedDir = path.join(tmp, 'sched')
let schedDaemonId
{
  const S = await boot(schedDir, { tickMs: 200 })
  const cs = api(S.base)
  const x = await cs('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('sched', 201), intervalHours: 0.0005 })
  if (!x.json.daemon) print('create failed', x.status, x.text)
  schedDaemonId = x.json.daemon.id
  const ok = await until(async () => (await cs('GET', `/api/daemons/${schedDaemonId}`)).json.history.filter((h) => h.trigger === 'schedule' && h.status === 'done').length >= 2, 9000)
  const det = (await cs('GET', `/api/daemons/${schedDaemonId}`)).json
  check('scheduler: reruns by itself (>= 2 scheduled runs within 9 s at a 1.8 s interval)', ok, `history=${det.history.map((h) => h.trigger + ':' + h.status).join(',')}`)
  const starts = det.history.map((h) => Date.parse(h.startedAt)).sort((a, b) => a - b)
  check('scheduler: runs are spaced by the interval, not back to back', starts.length >= 3 && starts[2] - starts[1] >= 1500, `${starts[2] - starts[1]} ms`)
  await cs('PATCH', `/api/daemons/${schedDaemonId}`, { enabled: false })
  await idle(S)
  const n = (await cs('GET', `/api/daemons/${schedDaemonId}`)).json.runs
  await sleep(2600)
  check('scheduler: a paused daemon is not rerun', (await cs('GET', `/api/daemons/${schedDaemonId}`)).json.runs === n)
  await cs('PATCH', `/api/daemons/${schedDaemonId}`, { enabled: true })
  await sleep(100)
  await S.close() // stop before the resumed daemon fires again; it is left due for the restart test
}

// ---- overdue after downtime: runs ONCE, not once per missed interval
{
  const before = JSON.parse(fs.readFileSync(path.join(schedDir, 'daemons.json'), 'utf8')).daemons.find((d) => d.id === schedDaemonId)
  await sleep(4600) // 2.5 intervals of downtime
  check('overdue: nextRunAt is in the past after the downtime', Date.parse(before.nextRunAt) < Date.now() - 2500, before.nextRunAt)
  const S2 = await boot(schedDir, { tickMs: 200 })
  const cs = api(S2.base)
  const t0 = Date.now()
  await until(async () => (await cs('GET', `/api/daemons/${schedDaemonId}`)).json.runs === before.runs + 1, 3000)
  const wait = 1000 - (Date.now() - t0)
  if (wait > 0) await sleep(wait)
  const after = (await cs('GET', `/api/daemons/${schedDaemonId}`)).json
  check('overdue: exactly one catch-up run after the restart (1 s window, 1.8 s interval)', after.runs === before.runs + 1 && after.history[0].trigger === 'schedule', `runs ${before.runs} -> ${after.runs}`)
  check('overdue: nextRunAt moved to end + interval (no backlog)', Date.parse(after.nextRunAt) > Date.now())
  await S2.close()
}

// ---- corrupt files: start empty, keep a .bak
{
  const d = path.join(tmp, 'corrupt')
  fs.mkdirSync(path.join(d, 'runs'), { recursive: true })
  fs.writeFileSync(path.join(d, 'credits.json'), '{not json')
  fs.writeFileSync(path.join(d, 'daemons.json'), '[1,2,')
  fs.writeFileSync(path.join(d, 'secrets.json'), '\u0000\u0000')
  fs.writeFileSync(path.join(d, 'runs', 'bad.json'), 'garbage')
  const C = await boot(d, { start: false })
  const cc = api(C.base)
  check('corrupt: starts with no daemons and the starting credits', (await cc('GET', '/api/daemons')).json.daemons.length === 0 && C.engine.credits.balance('hack-daemon') === 5000)
  check('corrupt: a .bak copy of each corrupt file is kept', ['credits.json', 'daemons.json', 'secrets.json'].every((n) => fs.readFileSync(path.join(d, n + '.bak'), 'utf8').length > 0) && fs.existsSync(path.join(d, 'runs', 'bad.json.bak')))
  check('corrupt: valid files are rewritten', await until(async () => { await C.engine.store.flush(); try { JSON.parse(fs.readFileSync(path.join(d, 'credits.json'), 'utf8')); return true } catch { return false } }, 2000))
  check('corrupt: the engine still works (create + run)', (await cc('POST', '/api/daemons', { tool: 'thumbnail-daemon', target: game('x', 301) })).status === 201)
  await C.close()
}

// ---- requests for new tooling (the "New tool" panel)
{
  const d = path.join(tmp, 'requests')
  const R = await boot(d, { start: false })
  const rc = api(R.base)
  const good = { message: 'Warn me when a copycat of my game reaches the top 50 in search.', contact: 'dev@example.com', game: 'https://www.roblox.com/games/1/x' }
  check('requests: empty list at first', (await rc('GET', '/api/requests')).json.requests.length === 0)
  const bads = [
    { ...good, message: 'too short' },
    { ...good, message: 'x'.repeat(2001) },
    { ...good, contact: ' ' },
    { ...good, contact: 'a\nb@example.com' },
    { ...good, game: 'g'.repeat(201) },
    { contact: 'dev@example.com' },
    { ...good, message: 'bad \u0000 byte in the description' },
  ]
  const badStatuses = []
  for (const b of bads) badStatuses.push((await rc('POST', '/api/requests', b)).status)
  check('requests: invalid input is a 400 with a plain message', badStatuses.every((s) => s === 400) && (await rc('POST', '/api/requests', bads[0])).json.message.includes('at least 12'), badStatuses.join(','))
  const ok = await rc('POST', '/api/requests', good)
  check('requests: a valid request is saved (201) and not marked delivered without a webhook', ok.status === 201 && ok.json.request.delivered === false && ok.json.request.contact === 'dev@example.com' && ok.json.request.message === good.message)
  const listed = (await rc('GET', '/api/requests')).json.requests
  check('requests: listed newest first', listed.length === 1 && listed[0].id === ok.json.request.id)
  await rc('POST', '/api/requests', { ...good, message: 'Second request about a weekly retention digest.', game: '  ' })
  check('requests: a blank game link is stored as null and the newest is first', (await rc('GET', '/api/requests')).json.requests[0].game === null)
  await R.engine.store.flush()
  const mode = fs.statSync(path.join(d, 'requests.json')).mode & 0o777
  check('requests: requests.json is mode 0600 (it holds contact details)', mode === 0o600, mode.toString(8))
  // automation requests carry the tool they are about
  const auto = await rc('POST', '/api/requests', { ...good, kind: 'automation', tool: 'dmca-daemon', message: 'Please send the DMCA takedowns for my game automatically.' })
  check('requests: an automation request keeps its kind and tool', auto.status === 201 && auto.json.request.kind === 'automation' && auto.json.request.tool === 'dmca-daemon')
  check('requests: new-tool requests have kind new-tool and no tool', ok.json.request.kind === 'new-tool' && ok.json.request.tool === null)
  const noTool = await rc('POST', '/api/requests', { ...good, kind: 'automation' })
  const badTool = await rc('POST', '/api/requests', { ...good, kind: 'automation', tool: 'nope-daemon' })
  const newTools = await Promise.all(['content-creator-daemon', 'rank-daemon', 'pulse-daemon'].map((t) => rc('POST', '/api/requests', { ...good, kind: 'automation', tool: t, message: `Automate ${t} for my game please.` })))
  check('requests: automation needs a real tool slug (400 otherwise), the new tools are accepted', noTool.status === 400 && badTool.status === 400 && /not in the toolkit/.test(badTool.json.message) && newTools.every((r) => r.status === 201 || r.status === 429))
  let limited = 0
  for (let i = 0; i < 6; i++) if ((await rc('POST', '/api/requests', good)).status === 429) limited++
  check('requests: more than 5 in 10 minutes is a 429 rate-limited', limited >= 2 && (await rc('POST', '/api/requests', good)).json.code === 'rate-limited')
  await R.close()
  const R2 = await boot(d, { start: false })
  check('requests: they survive a restart', (await api(R2.base)('GET', '/api/requests')).json.requests.length >= 2)
  await R2.close()

  // webhook: a 200 marks it delivered, a 500 does not, and it receives the text for Slack (text) and Discord (content)
  const hooks = []
  let hookStatus = 200
  const hook = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      hooks.push(JSON.parse(b))
      res.statusCode = hookStatus
      res.end('ok')
    })
  })
  await new Promise((r) => hook.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${hook.address().port}/h`
  const W = await boot(path.join(tmp, 'requests-hook'), { start: false, env: { REQUESTS_WEBHOOK_URL: url } })
  const wc = api(W.base)
  const sent = await wc('POST', '/api/requests', good)
  check('requests: a webhook 200 marks the request delivered', sent.json.request.delivered === true && hooks.length === 1)
  check('requests: the webhook gets text and content with the message, contact and game', hooks[0].text === hooks[0].content && hooks[0].text.includes(good.message) && hooks[0].text.includes('dev@example.com') && hooks[0].text.includes('Game: https://www.roblox.com/games/1/x'))
  const autoHook = await wc('POST', '/api/requests', { ...good, kind: 'automation', tool: 'thumbnail-daemon', message: 'Please auto-upload and optimize my thumbnails.' })
  check('requests: the webhook text names an automation request and its tool', autoHook.status === 201 && hooks[1].text.startsWith('Automation request: thumbnail-daemon'))
  hookStatus = 500
  const failed = await wc('POST', '/api/requests', { ...good, message: 'The webhook is down for this one, save it anyway.' })
  check('requests: a webhook failure still saves the request, delivered false', failed.status === 201 && failed.json.request.delivered === false && (await wc('GET', '/api/requests')).json.requests.length === 3)
  await W.close()
  await new Promise((r) => hook.close(r))
}

// ---- default data dir resolution
{
  const { resolveDataDir } = await import('../store.ts')
  check('store: DAEMON_DATA_DIR wins, default is <root>/.data', resolveDataDir('/proj', '/tmp/x') === '/tmp/x' && resolveDataDir('/proj', undefined) === path.join('/proj', '.data') && resolveDataDir('/proj', '  ') === path.join('/proj', '.data'))
}

fs.rmSync(tmp, { recursive: true, force: true })
print(`\n${pass} passed, ${fail} failed`)
if (fail) {
  print(logs.slice(-15).join('\n'))
  process.exit(1)
}
process.exit(0)
