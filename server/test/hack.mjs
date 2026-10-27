// Real end-to-end test of the Hack Daemon analyzer: real Roblox, real YouTube, real LLM. No mocks.
//   OPENROUTER_API_KEY="$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null)" node server/test/hack.mjs [steal|fisch|all]
// Writes the raw run output to .tmp/hack/<game>-run1.json and -run2.json (used by the detail view harness).
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLlm, DEFAULT_ANALYSIS_MODEL } from '../llm.ts'
import { ytWatch } from '../youtube.ts'
import { tool } from '../tools/hack.ts'
import { guardText } from '../tools/hack-rules.ts'
import { RunError } from '../tools/types.ts'

const key = process.env.OPENROUTER_API_KEY ?? ''
if (!key) {
  console.error('Set OPENROUTER_API_KEY (inline keychain pattern in .tmp/brief/SHARED.md).')
  process.exit(2)
}
const which = process.argv[2] ?? 'all'
const GAMES = {
  steal: { kind: 'roblox-game', universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' },
  fisch: { kind: 'roblox-game', universeId: 0, placeId: 16732694052, name: 'Fisch' },
}
const OUT = fileURLToPath(new URL('../../.tmp/hack/', import.meta.url))
mkdirSync(OUT, { recursive: true })

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

const llm = createLlm({ key, baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL })
let llmCalls = 0
let llmCost = 0
const countingLlm = {
  ...llm,
  async json(req, signal) {
    llmCalls++
    const r = await llm.json(req, signal)
    llmCost += r.costUsd ?? 0
    return r
  },
}

/* The slice of the run engine the analyzer sees: events collected, memory persisted as JSON between runs, isNew computed like server/runs.ts. */
function fakeEngine() {
  const store = {}
  return {
    store,
    async run(target, previous) {
      const events = []
      let t0 = Date.now()
      const mem = {
        get: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : undefined),
        set: (k, v) => void (store[k] = JSON.parse(JSON.stringify(v))),
      }
      const ctx = {
        tool: 'hack-daemon',
        target,
        trigger: 'user',
        runId: 'test-run',
        daemonId: 'test-daemon',
        now: new Date(),
        signal: new AbortController().signal,
        step: (id, label, state, detail) => {
          events.push({ type: 'step', id, label, state, detail })
          if (state !== 'active') console.log(`  +${((Date.now() - t0) / 1000).toFixed(0)}s [${state}] ${label}${detail ? ' :: ' + detail : ''}`)
        },
        summary: (summary) => events.push({ type: 'summary', summary }),
        finding: (f) => {
          const isNew = !previous.some((p) => p.id === f.id)
          events.push({ type: 'finding', finding: { ...f, isNew } })
        },
        llm: countingLlm,
        secrets: { get: () => null, has: () => false },
        memory: mem,
        previous,
      }
      t0 = Date.now()
      await tool.analyze(ctx)
      return { events, ms: Date.now() - t0, findings: events.filter((e) => e.type === 'finding').map((e) => e.finding), summary: events.find((e) => e.type === 'summary')?.summary }
    },
  }
}

const YT_WATCH = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/
const URLISH = /https?:\/\/|www\.|\.(com|net|org|io|gg|xyz)\b|`/i

function assertGuardrails(label, run, store) {
  const candidates = new Set(store.lastCandidates ?? [])
  const stepsText = JSON.stringify(run.events.filter((e) => e.type === 'step'))
  check(`${label}: run emitted a summary with sortLabel`, run.summary?.sortLabel === 'Sorted by severity')
  check(`${label}: summary has the five required items`, ['Videos searched', 'Exploit promos', 'Bait filtered', 'Clusters'].every((l) => run.summary.items.some((i) => i.label === l)) && run.summary.items.length === 5)
  check(`${label}: both notices present`, run.summary.notices.length === 2 && run.summary.notices[0].lead === 'Client anti-tamper does not fix server trust')
  check(`${label}: steps carry real counts (search steps and triage)`, /results,/.test(stepsText) && /exploit promos/.test(stepsText))
  let ids = new Set()
  let order = true
  const sevRank = { CRIT: 0, HIGH: 1, MED: 2, LOW: 3 }
  run.findings.forEach((f, i) => {
    const d = f.detail
    if (i > 0) {
      const p = run.findings[i - 1].detail
      if (sevRank[p.severity] > sevRank[d.severity] || (sevRank[p.severity] === sevRank[d.severity] && p.totalViews < d.totalViews)) order = false
    }
    check(`${label}: ${f.id} id format`, /^hack:[a-z-]+:[a-z0-9-]+$/.test(f.id))
    for (const field of ['observed', 'cause', 'fix']) {
      check(`${label}: ${f.id} ${field} has no URL or code`, !URLISH.test(d[field]) && guardText(d[field]) === null, `(${d.briefSource})`)
    }
    check(`${label}: ${f.id} no em dash or emoji in copy`, !/[—–·]|\p{Extended_Pictographic}/u.test(d.observed + d.cause + d.fix + f.title))
    check(`${label}: ${f.id} snippet is the observed text`, f.snippet[0].text.length > 20 && d.observed.startsWith(f.snippet[0].text.replace(/\.\.\.$/, '')))
    check(`${label}: ${f.id} url = most viewed video`, f.url === d.videos[0].url && d.videos.every((v) => (v.views ?? 0) <= (d.videos[0].views ?? 0)))
    check(`${label}: ${f.id} badge matches severity`, f.badge.label === d.severity)
    check(`${label}: ${f.id} no spark`, f.spark === undefined)
    check(`${label}: ${f.id} totalViews adds up`, d.totalViews === d.videos.reduce((s, v) => s + (v.views ?? 0), 0))
    for (const v of d.videos) {
      ids.add(v.id)
      if (!YT_WATCH.test(v.url) || v.url !== `https://www.youtube.com/watch?v=${v.id}` || !candidates.has(v.id)) check(`${label}: video ${v.id} link valid and from search results`, false, v.url)
    }
  })
  check(`${label}: findings sorted by severity then views`, order)
  check(`${label}: every video link is a youtube.com/watch URL and in the search results`, [...ids].every((id) => candidates.has(id)), `(${ids.size} videos)`)
  return [...ids]
}

function show(label, run) {
  console.log(`\n--- ${label}: ${run.findings.length} findings in ${(run.ms / 1000).toFixed(1)}s ---`)
  console.log('summary items:', run.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '))
  for (const n of run.summary.notes ?? []) console.log('note:', n)
  for (const f of run.findings.slice(0, 3)) {
    const d = f.detail
    console.log(`\n[${f.badge.label}] ${f.title}  (${f.id})  status=${f.status.label} isNew=${f.isNew}`)
    console.log(`  severity: ${d.severityReason}`)
    console.log(`  observed: ${d.observed}\n  cause:    ${d.cause}\n  fix:      ${d.fix}`)
    console.log(`  confidence ${d.confidence}, brief from ${d.briefSource}, videos ${d.videos.length}, views ${d.totalViews}, 14d ${d.views14d}`)
    for (const v of d.videos.slice(0, 3)) console.log(`    ${v.views?.toLocaleString('en-US') ?? '?'} views  ${v.publishedText ?? '?'}  ${v.channel}  ${v.url}\n      ${v.title}`)
  }
}

/* Guardrail path with the real YouTube and real triage, but a scripted brief writer: bad output must be rejected, regenerated once, then replaced by the class table. */
async function guardTest() {
  console.log('\n===== guardrail regeneration and fallback (Fisch, scripted brief writer) =====')
  const BAD = [
    { observed: 'Download it from https://example.com/get and paste it.', cause: 'The server trusts the client and nothing checks the call at all here.', fix: 'Validate every RemoteEvent argument on the server and rate limit each player.' },
    { observed: 'The cheat advertises auto farming for the fishing system with many videos.', cause: 'The server trusts the client and nothing checks the call at all here.', fix: 'Run it in Delta executor then validate every RemoteEvent argument on the server and rate limit.' },
    { observed: 'The cheat advertises auto farming for the fishing system with many videos.', cause: 'The server trusts the client and nothing checks the call at all here.', fix: 'Use ```lua\nremote:FireServer(1)\n``` to see what is sent and then validate arguments.' },
    { observed: 'The cheat advertises auto farming for the fishing system with many videos.', cause: 'First step 1 is to open the tool. The server trusts the client in this case.', fix: 'Validate every RemoteEvent argument on the server and rate limit each player.' },
  ]
  const GOOD = { observed: 'The videos advertise automated fishing that collects rewards without a player at the controls.', cause: 'Hypothesis: a RemoteEvent handler grants rewards for requests that carry no proof of real play.', fix: 'Validate every RemoteEvent argument on the server, check distance and cooldowns, and rate limit each player.' }
  for (const mode of ['bad-then-good', 'always-bad']) {
    let n = 0
    const seq = { calls: 0 }
    const scripted = {
      ...llm,
      async json(req, signal) {
        if (req.name !== 'hack_brief') return countingLlm.json(req, signal)
        const i = req.user.includes('previous answer was rejected') ? 1 : 0
        const k = req.user.length + (seq.calls++ - seq.calls) // stable pick of a bad sample per cluster prompt
        const data = mode === 'bad-then-good' ? (i === 0 ? BAD[k % BAD.length] : GOOD) : BAD[k % BAD.length]
        return { data, costUsd: 0, model: 'scripted' }
      },
    }
    const engine = fakeEngine()
    const events = []
    const store = engine.store
    const ctx = {
      tool: 'hack-daemon', target: GAMES.fisch, trigger: 'user', runId: 'g', daemonId: 'g', now: new Date(), signal: new AbortController().signal,
      step: (id, label, state, detail) => { events.push({ id, label, state, detail }) }, summary: () => {}, finding: (f) => events.push({ finding: f }),
      llm: scripted, secrets: { get: () => null, has: () => false }, memory: { get: (k) => store[k], set: (k, v) => void (store[k] = v) }, previous: [],
    }
    await tool.analyze(ctx)
    const fs = events.filter((e) => e.finding).map((e) => e.finding)
    const briefStep = events.find((e) => e.id === 'briefs' && e.state !== 'active')
    console.log(`  ${mode}: briefs step -> [${briefStep.state}] ${briefStep.detail}`)
    if (mode === 'bad-then-good') check('guard: every cluster used the model brief after one regeneration', fs.length > 0 && fs.every((f) => f.detail.briefSource === 'model' && f.detail.observed === GOOD.observed))
    else check('guard: always-bad briefs fall back to the class table, with a warn step', fs.length > 0 && fs.every((f) => f.detail.briefSource === 'class-template' && guardText(f.detail.observed + f.detail.cause + f.detail.fix) === null) && briefStep.state === 'warn')
    check(`guard (${mode}): no bad text reached any finding`, fs.every((f) => !/example\.com|Delta|```|step 1/i.test(JSON.stringify(f.detail))))
  }
  // And the check itself, on its own.
  check('guardText rejects url, code fence, executor name, steps and accepts plain advice',
    guardText('see www.foo.com') === 'url' && guardText('```x```') === 'code' && guardText('use Synapse X') === 'denylist' && guardText('Step 1: paste it') !== null && guardText('Validate every RemoteEvent argument on the server and check distance.') === null)
}

if (which === 'guard') {
  await guardTest()
  console.log(`\nLLM calls: ${llmCalls}\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

for (const name of which === 'all' ? ['steal', 'fisch'] : [which]) {
  const target = GAMES[name]
  console.log(`\n===== ${target.name} (place ${target.placeId}) =====`)
  const engine = fakeEngine()
  try {
    const run1 = await engine.run(target, [])
    show(`${target.name} run 1`, run1)
    const ids1 = assertGuardrails(`${target.name} run1`, run1, engine.store)
    writeFileSync(`${OUT}${name}-run1.json`, JSON.stringify({ events: run1.events }, null, 1))
    check(`${target.name} run1: labelled First run`, run1.summary.items.some((i) => i.label === 'First run') && run1.findings.every((f) => f.detail.firstRun && f.detail.newVideoIds.length === f.detail.videos.length))
    check(`${target.name} run1: memory has seen ids`, Array.isArray(engine.store.seen) && ids1.every((id) => engine.store.seen.includes(id)))
    // Spot check against YouTube itself: titles and ids of up to 3 shown videos exist on their watch page.
    for (const f of run1.findings.slice(0, 1))
      for (const v of f.detail.videos.slice(0, 2)) {
        const w = await ytWatch(v.id).catch((e) => (console.log(`  (watch spot check skipped: ${e.message})`), null))
        if (!w) continue
        check(`${target.name}: watch page of ${v.id} exists and title matches`, w?.title === v.title, w ? '' : '(watch page unavailable)')
      }
    // Run 2 with memory: nothing from run 1 may count as new.
    console.log(`\n--- ${target.name} run 2 (same memory, previous findings passed) ---`)
    const run2 = await engine.run(target, run1.findings)
    show(`${target.name} run 2`, run2)
    writeFileSync(`${OUT}${name}-run2.json`, JSON.stringify({ events: run2.events }, null, 1))
    assertGuardrails(`${target.name} run2`, run2, engine.store)
    const newItem = run2.summary.items.find((i) => i.label === 'New this run')
    check(`${target.name} run2: labelled "New this run", not First run`, !!newItem && !run2.summary.items.some((i) => i.label === 'First run'))
    const known = new Set(ids1)
    const reallyNew = new Set(run2.findings.flatMap((f) => f.detail.newVideoIds))
    check(`${target.name} run2: newVideoIds are all absent from run 1`, [...reallyNew].every((id) => !known.has(id)), `(${reallyNew.size} new of ${new Set(run2.findings.flatMap((f) => f.detail.videos.map((v) => v.id))).size})`)
    check(`${target.name} run2: summary count equals sum of newVideoIds`, newItem && Number(newItem.value) === run2.findings.reduce((s, f) => s + f.detail.newVideoIds.length, 0), `(${newItem?.value})`)
    check(`${target.name} run2: no firstRun flag`, run2.findings.every((f) => !f.detail.firstRun))
    check(`${target.name} run2: status chip is "Open" or "N new videos"`, run2.findings.every((f) => f.status.label === 'Open' || /^\d+ new videos?$/.test(f.status.label)))
    console.log('run2 isNew per finding:', run2.findings.map((f) => `${f.id}:${f.isNew}/${f.status.label}`).join(', ') || '(none)')
  } catch (err) {
    check(`${target.name}: ran without throwing`, false, err instanceof RunError ? `${err.code}: ${err.message}` : String(err?.stack ?? err))
  }
}

console.log(`\nLLM calls: ${llmCalls}, billed about $${llmCost.toFixed(4)}`)
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
