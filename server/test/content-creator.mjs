// Content Creator Daemon against REAL YouTube and the REAL LLM. Needs the OpenRouter key in the environment, inline:
//   OPENROUTER_API_KEY="$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null)" node server/test/content-creator.mjs [steal|fisch|all]
// For each game: runs the analyzer, prints the ranked creators and one full draft, then verifies that every channel and
// video link points at an id that appeared in a page this run fetched, that no draft invents a number, an offer or a
// promise, that an email appears only if it was in fetched text, that the owner's marks survive a rerun and that nothing
// already seen is marked New on the rerun. Pure checks (the exploit filter, the score spread) run first.
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DAEMON_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'content-creator-test-'))
const { tool } = await import('../tools/content-creator.ts')
const { setMark } = await import('../tools/content-creator-pipeline.ts')
const { isExploitChannel, isExploitTitle, scoreFit } = await import('../tools/content-creator-score.ts')
const { findPublicContact } = await import('../tools/content-creator-contacts.ts')
const { draftTextOk } = await import('../tools/content-creator-draft.ts')
const { createLlm, DEFAULT_ANALYSIS_MODEL } = await import('../llm.ts')

const key = process.env.OPENROUTER_API_KEY ?? ''
const GAMES = {
  steal: { universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' },
  fisch: { universeId: 5750914919, placeId: 16732694052, name: 'Fisch' },
}
const which = process.argv[2] ?? 'all'

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

/* ---- pure checks, no network ---- */
check('exploit filter: a channel named like a script seller is excluded', isExploitChannel('Steal An Egg Scripts 2026', ['Steal An Egg gameplay']))
check('exploit filter: a no-key executor title is an exploit title', isExploitTitle('Steal An Egg script NO KEY executor'))
check('exploit filter: a plain gameplay channel is kept', !isExploitChannel('Calm Gamer', ['Steal An Egg gameplay', 'I hatched every egg']) && !isExploitTitle('I hatched every egg in Steal An Egg'))
check('exploit filter: a channel with half its titles about hacks is excluded', isExploitChannel('Gamer X', ['Fisch hack', 'Fisch exploit gui', 'Fisch gameplay']))
const base = { game: 'Fisch', uploadsRead: 24, gameUploads30d: 5, similarUploads: 4, median: 20000, subscribers: 400000, viewsPerSub: 0.05, sampled: 5, sponsored: 0, sponsoredMedian: null, channelMedian: 20000, flags: [], titlesChecked: 24 }
const six = scoreFit({ ...base, gameUploads: 6 }).components[0].points
const all24 = scoreFit({ ...base, gameUploads: 24 }).components[0].points
check('score: a daily uploader (24 of 24 about the game) gets no more coverage than 6 of 24', six === all24, `${six} vs ${all24}`)
const lo = scoreFit({ ...base, gameUploads: 6, viewsPerSub: 0.02 }).score
const hi = scoreFit({ ...base, gameUploads: 6, viewsPerSub: 0.08 }).score
check('score: views per subscriber spreads the score (2% vs 8%)', hi - lo >= 6, `${lo} vs ${hi}`)
check('score: a high brand-safety flag makes it Risky', scoreFit({ ...base, gameUploads: 6, flags: [{ confidence: 'high' }] }).tier === 'Risky')
const c = findPublicContact([
  { where: 'the channel About text', text: 'I make videos\nBusiness: hello@example.com\nfollow https://x.com/me' },
  { where: 'the channel description', text: 'no address here, write me at name [at] domain dot com' },
])
check('contact: an email is returned only when it is written verbatim, with where it was found', c.email === 'hello@example.com' && c.source === 'the channel About text' && c.excerpt.includes('hello@example.com'))
check('contact: a spelled-out address is not guessed', findPublicContact([{ where: 'x', text: 'mail me: name [at] domain dot com' }]).email === null)
check(
  'draft text: promises, pressure and unknown numbers are rejected',
  !draftTextOk('Get free Robux today.', new Set(), 100) &&
    !draftTextOk('Limited time, reply now.', new Set(), 100) &&
    !draftTextOk('Your 5 million viewers would love it.', new Set(), 100) &&
    draftTextOk('Your channel covers the same kind of game.', new Set(), 100),
)

if (!key) {
  console.error('OPENROUTER_API_KEY is not set (pass it inline from the keychain). Pure checks only.')
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 2)
}

/* ---- live: record every id and email that appears in any YouTube page the run fetches ---- */
const seenIds = new Set()
const seenEmails = new Set()
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
    for (const m of body.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) seenEmails.add(m[0])
  }
  return res
}

function makeCtx(target, daemonId, memStore) {
  const events = { steps: [], findings: [], summary: null }
  const ac = new AbortController()
  const ctx = {
    tool: 'content-creator-daemon',
    target: { kind: 'roblox-game', ...target },
    trigger: 'user',
    runId: 'test',
    daemonId,
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

const idOf = (u) => /^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})$/.exec(u)?.[1] ?? /^https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})$/.exec(u)?.[1] ?? null
const digitsOf = (s) => s.match(/\d+/g) ?? []

async function runGame(label, target) {
  console.log(`\n=== ${label} ===`)
  const daemonId = `test-${label.replace(/\W+/g, '-').toLowerCase()}`
  const mem = new Map()
  const t0 = Date.now()
  const { ctx, events } = makeCtx(target, daemonId, mem)
  await tool.analyze(ctx)
  console.log(`run 1 took ${Math.round((Date.now() - t0) / 1000)}s, ${pagesFetched} YouTube pages fetched so far`)
  console.log('summary:', events.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '))
  console.log('notice:', events.summary.notices?.map((n) => `${n.lead} ${n.body}`).join(' '))
  const fs = events.findings
  check(`${label}: found creators`, fs.length > 0, String(fs.length))
  console.log('\nRank Fit Tier         Pipeline     Creator                        Subs     Median   URL')
  fs.slice(0, 8).forEach((f, i) => {
    const d = f.detail
    console.log(`${String(i + 1).padStart(3)}  ${String(d.fit.score).padStart(3)} ${d.fit.tier.padEnd(12)} ${f.status.label.padEnd(12)} ${f.title.slice(0, 30).padEnd(30)} ${f.meta[0].value.padStart(7)} ${f.meta[1].value.padStart(8)}  ${f.url}`)
  })
  console.log(`(all ${fs.length}: fit scores ${fs.map((f) => f.detail.fit.score).join(', ')})`)

  const nonRisky = fs.filter((f) => f.detail.fit.tier !== 'Risky')
  check(`${label}: ranked by fit, Risky last`, nonRisky.every((f, i) => i === 0 || nonRisky[i - 1].detail.fit.score >= f.detail.fit.score) && fs.slice(nonRisky.length).every((f) => f.detail.fit.tier === 'Risky'))
  const strongish = fs.filter((f) => f.detail.fit.score >= 80).length
  check(
    `${label}: scores are spread, not a wall of 80s`,
    fs.length < 4 || (strongish <= Math.ceil(fs.length / 3) && new Set(fs.map((f) => f.detail.fit.score)).size >= Math.min(4, fs.length - 1)),
    `${strongish} of ${fs.length} at 80 or more`,
  )
  check(`${label}: first run marks every creator New`, fs.every((f) => f.status.label === 'New'))
  check(`${label}: finding ids are content-creator:<channelId>`, fs.every((f) => f.id === `content-creator:${f.detail.channel.id}`))
  check(`${label}: the permanent notice is present`, !!events.summary.notices?.some((n) => `${n.lead} ${n.body}` === 'Not collected: private details. Contacts only if the creator published them.'))

  /* every link points at an id that was in a fetched page */
  const bad = []
  let urls = 0
  const verify = (u) => {
    urls++
    const id = idOf(u)
    if (!id || !seenIds.has(id)) bad.push(u)
  }
  for (const f of fs) {
    const d = f.detail
    verify(f.url)
    verify(d.channel.url)
    if (d.channel.aboutUrl !== `${d.channel.url}/about`) bad.push(d.channel.aboutUrl)
    if (d.video) verify(d.video.url)
    d.sponsorship.examples.forEach((v) => verify(v.url))
    d.safety.flags.forEach((v) => verify(v.url))
    if (d.draft) {
      const links = d.draft.body.match(/https?:\/\/[^\s)]+/g) ?? []
      links.forEach((l) => {
        urls++
        if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(l) || !seenIds.has(idOf(l))) bad.push(l)
      })
    }
  }
  check(`${label}: all ${urls} channel and video links are well formed and their ids appeared in fetched pages`, bad.length === 0, bad.slice(0, 3).join(' '))

  /* drafts */
  const drafted = fs.filter((f) => f.detail.draft)
  check(
    `${label}: every Strong or Good fit has a draft, no other tier does`,
    fs.every((f) => (['Strong fit', 'Good fit'].includes(f.detail.fit.tier) ? !!f.detail.draft : !f.detail.draft)),
    `${drafted.length} drafts`,
  )
  let draftBad = ''
  for (const f of drafted) {
    const d = f.detail
    const { subject, body, placeholders } = d.draft
    if (!subject || !body) draftBad = `${f.title}: empty subject or body`
    const text = `${subject}\n${body}`
    const noUrl = text.replace(d.video.url, '')
    const noBracket = noUrl.replace(/\[[^\]]+\]/g, '')
    const allowed = new Set([...digitsOf(d.game), ...digitsOf(d.channel.name), ...digitsOf(d.video.title)])
    const stray = digitsOf(noBracket).filter((x) => !allowed.has(x))
    if (stray.length) draftBad = `${f.title}: invented number ${stray.join(',')}`
    if (!body.includes(d.video.url) || !body.includes(d.video.title) || !body.includes(d.game) || !body.includes(d.channel.name)) draftBad = `${f.title}: draft misses the video title, link, game or creator name`
    if (placeholders.length < 2 || !placeholders.every((p) => /^\[[^\]]+\]$/.test(p) && body.includes(p)) || !body.includes('[your offer]') || !body.includes('[your rate range]') || !body.includes('[your name]')) draftBad = `${f.title}: placeholders missing`
    const prose = noBracket.replace(`"${d.video.title}"`, '').replace(d.game, '')
    if (/\b(free|robux|guarantee\w*|exclusive|limited time|urgent|act now|last chance)\b|\$\d/i.test(prose)) draftBad = `${f.title}: promise or pressure wording`
    if (/[—–·]/.test(text)) draftBad = `${f.title}: em dash or middle dot`
    if (d.contact.email && body.includes(d.contact.email)) draftBad = `${f.title}: the draft carries the creator's address`
  }
  check(`${label}: each draft has a subject and body, a real video title and link, bracketed placeholders for terms, no invented number, no promise`, draftBad === '', draftBad)

  /* emails */
  const withEmail = fs.filter((f) => f.detail.contact.email)
  check(
    `${label}: an email appears only if it is verbatim in fetched text and its source is shown`,
    withEmail.every((f) => seenEmails.has(f.detail.contact.email) && f.detail.contact.source && f.detail.contact.excerpt?.includes(f.detail.contact.email)) && fs.filter((f) => !f.detail.contact.email).every((f) => f.detail.contact.source === null),
    `${withEmail.length} with a public email`,
  )
  check(`${label}: Ready only with an email`, fs.every((f) => f.status.label !== 'Ready' || f.detail.contact.email))
  const generated = JSON.stringify(fs.map((f) => ({ ...f, detail: { ...f.detail, channel: undefined, video: undefined, safety: undefined } })))
  check(`${label}: no em dashes or middle dots in generated strings`, !/[—–·]/.test(generated))
  let inv = true
  for (const f of fs) {
    const d = f.detail
    if (d.fit.components.reduce((n, x) => n + x.points, 0) !== d.fit.score) inv = false
    if (d.fit.tier === 'Risky' && !d.safety.flags.some((x) => x.confidence === 'high')) inv = false
    if (d.fit.components.length < 4 || d.fit.components.length > 6) inv = false
    if (/script|exploit|executor|no[ -]?key/i.test(d.channel.name)) inv = false
  }
  check(`${label}: components sum to score, 4 to 6 of them, Risky only with a high flag, no exploit channel`, inv)

  if (drafted.length) {
    const sample = drafted[0]
    console.log(`\n--- full draft for ${sample.title} (${sample.detail.fit.tier}, fit ${sample.detail.fit.score}) ---`)
    console.log(`Subject: ${sample.detail.draft.subject}\n\n${sample.detail.draft.body}`)
    console.log('\n--- that finding without the draft ---')
    console.log(JSON.stringify({ ...sample, detail: { ...sample.detail, draft: undefined } }, null, 1))
  }

  /* owner marks survive a rerun */
  if (fs.length >= 3) {
    await setMark(daemonId, fs[0].detail.channel.id, 'contacted')
    await setMark(daemonId, fs[1].detail.channel.id, 'replied')
    await setMark(daemonId, fs[2].detail.channel.id, 'new')
  }
  console.log('\n(rerun with the same memory and the owner marks)')
  const second = makeCtx(target, daemonId, mem)
  await tool.analyze(second.ctx)
  const first = new Set(fs.map((f) => f.id))
  const again = second.events.findings
  const wrongNew = again.filter((f) => f.status.label === 'New' && first.has(f.id) && f.id !== fs[2]?.id)
  const trulyNew = again.filter((f) => !first.has(f.id))
  check(`${label}: rerun marks nothing New that was in run 1 (except the one sent back to new)`, wrongNew.length === 0, `${again.length} creators, ${again.map((f) => f.status.label).join('/')}`)
  check(`${label}: creators first seen on the rerun are New`, trulyNew.every((f) => f.status.label === 'New'), `${trulyNew.length} not in run 1`)
  if (fs.length >= 3) {
    const st = (id) => again.find((f) => f.id === id)?.status.label
    const got = [st(fs[0].id), st(fs[1].id), st(fs[2].id)]
    check(`${label}: the owner's marks (contacted, replied, back to new) are kept`, got.every((s, i) => s === undefined || s === ['Contacted', 'Replied', 'New'][i]), got.join('/'))
  }
  console.log(trulyNew.length ? `note: not in run 1, so New: ${trulyNew.map((f) => f.title).join(', ')}` : 'rerun: no creator is new')
  return { findings: fs, summary: events.summary, rerun: again }
}

const out = {}
for (const [k, t] of Object.entries(GAMES)) {
  if (which !== 'all' && which !== k) continue
  out[k] = await runGame(t.name, t)
  if (process.env.CONTENT_CREATOR_DUMP) {
    writeFileSync(process.env.CONTENT_CREATOR_DUMP, JSON.stringify(out, null, 1))
    console.log('dumped findings to', process.env.CONTENT_CREATOR_DUMP)
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
