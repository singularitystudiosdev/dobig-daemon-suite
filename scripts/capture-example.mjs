// Captures one REAL run per tool on one real game and writes public/examples/<slug>.json (the ToolExample shape in
// src/lib/example.ts). The public GitHub Pages site cannot run the tools, so it shows these files.
//   K=$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null) && OPENROUTER_API_KEY="$K" node scripts/capture-example.mjs <slug|all> [--rebuild]
// Stage 1 runs the analyzer exactly like server/runs.ts does (a RunContext, steps, summary and findings as emitted, empty memory,
// no previous run) and keeps the raw output in .tmp/examples-raw/<slug>.json. Stage 2 shapes that into the example file:
// hero images, a hero note, and the few things a public file must not carry (email addresses, video titles of exploit promos).
// --rebuild skips stage 1 and reshapes the saved raw output, so nothing is captured twice. Nothing is invented: every finding
// is what the analyzer emitted. The OpenRouter key is read from the environment and is never printed or written.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = path.join(ROOT, 'public/examples')
const RAW = path.join(ROOT, '.tmp/examples-raw')
mkdirSync(OUT, { recursive: true })
mkdirSync(RAW, { recursive: true })
process.env.DAEMON_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'capture-example-')) // the Content Creator pipeline writes here, not into .data

const SLUGS = ['creator-dox', 'thumbnail-daemon', 'discord-daemon', 'description-daemon', 'dmca-daemon', 'hack-daemon', 'content-creator-daemon', 'rank-daemon', 'pulse-daemon']
const GAME = { name: 'Steal An Egg', placeId: 107778070777162, universeId: 10563114921, url: 'https://www.roblox.com/games/107778070777162/Steal-An-Egg' }
const TARGET = { kind: 'roblox-game', universeId: GAME.universeId, placeId: GAME.placeId, name: GAME.name }
const INVITE = 'S9y7aJ5JxQ'
const KEY = process.env.OPENROUTER_API_KEY ?? ''
const TITLE_WITHHELD = 'Title withheld in this public example'

const args = process.argv.slice(2)
const rebuild = args.includes('--rebuild')
const which = args.find((a) => !a.startsWith('--')) ?? 'all'
const wanted = which === 'all' ? SLUGS : [which]
for (const s of wanted) if (!SLUGS.includes(s)) throw new Error(`Unknown slug ${s}. Use one of: ${SLUGS.join(', ')}, all`)

const { createLlm, DEFAULT_ANALYSIS_MODEL } = await import('../server/llm.ts')
const { fetchGalleryUrls, downloadRobloxImage } = await import('../server/roblox.ts')

const log = (slug, msg) => console.log(`[${slug}] ${msg}`)
const clone = (x) => JSON.parse(JSON.stringify(x))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let llmCost = 0
let llmCalls = 0
const baseLlm = createLlm({ key: KEY, baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL })
const llm = {
  ...baseLlm,
  async json(req, signal) {
    llmCalls++
    const r = await baseLlm.json(req, signal)
    llmCost += r.costUsd ?? 0
    return r
  },
}

/* ---------------------------------------------------------------- stage 1: run the analyzer for real */
async function runAnalyzer(slug, analyze, { target = TARGET, useLlm = true } = {}) {
  const mem = new Map()
  const events = { steps: [], summary: null, findings: [] }
  const t0 = Date.now()
  const ctx = {
    tool: slug,
    target,
    trigger: 'user',
    runId: 'capture',
    daemonId: 'capture',
    now: new Date(),
    signal: new AbortController().signal,
    step: (id, label, state, detail) => {
      events.steps.push({ id, label, state, detail })
      if (state !== 'active') log(slug, `+${Math.round((Date.now() - t0) / 1000)}s ${state} ${label}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`)
    },
    summary: (s) => (events.summary = clone(s)),
    // The engine marks isNew only against an earlier finished run; there is none, so false (server/runs.ts).
    finding: (f) => events.findings.push({ ...clone(f), isNew: false }),
    llm: useLlm ? llm : { available: false, model: 'none', json: async () => { throw new Error('This tool does not use the model') } },
    secrets: { get: () => null, has: () => false },
    memory: { get: (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : undefined), set: (k, v) => mem.set(k, JSON.stringify(v)) },
    previous: [],
  }
  await analyze(ctx)
  return { capturedAt: new Date().toISOString(), ms: Date.now() - t0, summary: events.summary, findings: events.findings }
}

async function discordInvite(code) {
  const { inviteToServer } = await import('../server/tools/discord.ts')
  const { apiBase } = await import('../server/discord/client.ts')
  const res = await fetch(`${apiBase()}/invites/${encodeURIComponent(code)}?with_counts=true`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Discord invite ${code} answered ${res.status}`)
  const s = inviteToServer(code, await res.json())
  if (!s) throw new Error('Discord returned no server for that invite')
  return s
}

async function openRouterUsage() {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${KEY}` } })
    const j = await r.json()
    return typeof j?.data?.usage === 'number' ? j.data.usage : null
  } catch {
    return null
  }
}

const sh = (bin, a) => execFileSync(bin, a, { stdio: ['ignore', 'pipe', 'pipe'] })

async function captureThumbnail(slug, gallery) {
  const { watchThumbnails } = await import('../server/watch-thumbnails.ts')
  const { generateWithOpenRouter } = await import('../server/openrouter.ts')
  const { OPENROUTER_MODEL, VARIANT_PROMPT, VARIANTS_PER_THUMB } = await import('../src/lib/apiTypes.ts')
  const { sniff } = await import('../server/gemini.ts')
  const run = await runAnalyzer(slug, watchThumbnails, { useLlm: false })
  if (!KEY) throw new Error('OPENROUTER_API_KEY is needed for the thumbnail variants.')
  const dir = path.join(OUT, 'thumbnail-daemon')
  mkdirSync(dir, { recursive: true })
  const url = gallery[0]
  const bytes = await downloadRobloxImage(url)
  if (!bytes) throw new Error('Could not download the gallery thumbnail')
  const image = { mime: sniff(bytes) ?? 'image/jpeg', base64: bytes.toString('base64') }
  const small = (src, dest) => sh('magick', [src, '-resize', '640x360^', '-gravity', 'center', '-extent', '640x360', '-strip', '-quality', '80', dest])
  const rawDir = mkdtempSync(path.join(os.tmpdir(), 'capture-thumb-'))
  writeFileSync(path.join(rawDir, 'original'), bytes)
  small(path.join(rawDir, 'original'), path.join(dir, 'original.jpg'))
  const before = await openRouterUsage()
  const results = await Promise.all(
    Array.from({ length: VARIANTS_PER_THUMB }, async (_, i) => {
      const t0 = Date.now()
      const img = await generateWithOpenRouter({ baseUrl: 'https://openrouter.ai', model: OPENROUTER_MODEL, apiKey: KEY, prompt: VARIANT_PROMPT, image, signal: new AbortController().signal })
      log(slug, `variant ${i + 1} generated in ${Math.round((Date.now() - t0) / 1000)}s (${img.mime}, ${img.bytes.length} bytes)`)
      const f = path.join(rawDir, `v${i + 1}`)
      writeFileSync(f, img.bytes)
      small(f, path.join(dir, `variant-${i + 1}.jpg`))
    }),
  )
  void results
  const after = await openRouterUsage()
  const spend = before !== null && after !== null ? Math.round((after - before) * 10000) / 10000 : null
  log(slug, `OpenRouter spend on variants (account usage delta): ${spend === null ? 'unknown' : '$' + spend}`)
  return { ...run, variants: { original: '/examples/thumbnail-daemon/original.jpg', items: [1, 2, 3].map((i) => `/examples/thumbnail-daemon/variant-${i}.jpg`), prompt: VARIANT_PROMPT }, sourceThumb: url, spend }
}

async function capture(slug, gallery) {
  switch (slug) {
    case 'creator-dox':
      return runAnalyzer(slug, (await import('../server/tools/creator.ts')).tool.analyze, { useLlm: false })
    case 'thumbnail-daemon':
      return captureThumbnail(slug, gallery)
    case 'discord-daemon':
      return { capturedAt: new Date().toISOString(), summary: null, findings: [], server: await discordInvite(INVITE) }
    case 'description-daemon':
      return runAnalyzer(slug, (await import('../server/tools/description.ts')).tool.analyze)
    case 'dmca-daemon':
      return runAnalyzer(slug, (await import('../server/tools/dmca.ts')).tool.analyze)
    case 'hack-daemon':
      return runAnalyzer(slug, (await import('../server/tools/hack.ts')).tool.analyze)
    case 'content-creator-daemon':
      return runAnalyzer(slug, (await import('../server/tools/content-creator.ts')).tool.analyze)
    case 'rank-daemon':
      return runAnalyzer(slug, (await import('../server/tools/rank.ts')).tool.analyze)
    case 'pulse-daemon':
      return runAnalyzer(slug, (await import('../server/tools/pulse.ts')).tool.analyze, { useLlm: false })
  }
}

/* ---------------------------------------------------------------- stage 2: shape the example file */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const num = (n) => Number(n).toLocaleString('en-US')

async function status(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      await r.arrayBuffer().catch(() => undefined)
      if (r.status === 429) { await sleep(3000); continue }
      return r.status
    } catch {
      await sleep(1000)
    }
  }
  return 0
}

function shape(slug, raw, cover) {
  const notes = []
  let findings = clone(raw.findings) // never mutate the saved raw output
  let hero = [{ url: cover, caption: 'The game' }]
  let heroNote = `${GAME.name} on Roblox, the game this example run was captured on.`
  const extra = {}

  if (slug === 'dmca-daemon') {
    const f = findings.find((x) => x.detail?.imagePairs?.length)
    const p = f?.detail.imagePairs[0]
    if (p) {
      hero = [{ url: p.ours, caption: 'Your game' }, { url: p.theirs, caption: 'A copy found' }]
      const d = f.detail
      heroNote = p.identical
        ? `${d.candidate.name}: the image is byte-for-byte identical to ${GAME.name}'s thumbnail.`
        : `${d.candidate.name}: best image differs by ${p.distance} of 64 hash bits from ${GAME.name}'s thumbnail.`
    } else notes.push('no image pair found; hero is the cover only')
  }

  if (slug === 'content-creator-daemon') {
    findings = findings.slice(0, 6)
    for (const f of findings) {
      f.detail.contact = { ...f.detail.contact, email: null, source: null, excerpt: null }
    }
    const top = findings.find((f) => f.detail.fit.tier === 'Strong fit' && f.detail.video) ?? findings.find((f) => f.detail.video)
    if (top) {
      const id = /[?&]v=([\w-]{11})/.exec(top.detail.video.url)?.[1]
      if (id) {
        hero = [{ url: cover, caption: 'The game' }, { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, caption: `${top.detail.channel.name} plays it` }]
        heroNote = `${top.detail.channel.name} (${top.detail.fit.tier}, fit ${top.detail.fit.score}) has a real video about ${GAME.name}.`
        if (top.detail.fit.tier !== 'Strong fit') notes.push(`no Strong fit creator; used ${top.detail.fit.tier}`)
      }
    }
  }

  if (slug === 'hack-daemon') {
    findings = findings.slice(0, 4)
    for (const f of findings) {
      f.detail.videos = f.detail.videos.slice(0, 3).map((v) => ({ ...v, title: TITLE_WITHHELD }))
    }
    heroNote = `${GAME.name}: the game whose YouTube exploit promotions this run searched. Titles of the promo videos are withheld here.`
  }

  if (slug === 'creator-dox') {
    heroNote = `${GAME.name} and its official Discord server, both found by the run from the game page.`
  }


  if (slug === 'thumbnail-daemon') {
    extra.variants = raw.variants
    hero = [{ url: raw.variants.original, caption: 'Original' }, { url: raw.variants.items[0], caption: 'Variant' }]
    heroNote = `One real ${GAME.name} gallery thumbnail and one of three variants Nano Banana made from it with the prompt "${raw.variants.prompt}".`
  }

  if (slug === 'discord-daemon') {
    const s = raw.server
    extra.server = { name: s.name, members: s.members, online: s.online, iconUrl: s.iconUrl, inviteUrl: `https://discord.gg/${INVITE}` }
    extra.note = 'The Discord Daemon reads your own server through a bot you create, so there is no public example run. This is the public lookup of the game\'s official server.'
    hero = [{ url: cover, caption: 'The game' }, ...(s.iconUrl ? [{ url: s.iconUrl, caption: 'Official Discord' }] : [])]
    heroNote = `${s.name} is the official ${GAME.name} Discord${s.members != null ? `, ${num(s.members)} members` : ''}${s.online != null ? `, ${num(s.online)} online` : ''}.`
  }

  if (slug === 'rank-daemon') heroNote = `${GAME.name}: ${findings.length} search phrases checked for where the game ranks on Roblox.`
  if (slug === 'pulse-daemon') heroNote = `${GAME.name}: live players, likes, server health and update status read from public Roblox data.`
  if (slug === 'description-daemon') heroNote = `${GAME.name}: the game's real description and metadata, checked against Roblox's content rules.`

  const example = {
    tool: slug,
    capturedAt: raw.capturedAt,
    game: { ...{ name: GAME.name, placeId: GAME.placeId, url: GAME.url }, cover },
    hero,
    heroNote,
    summary: slug === 'discord-daemon' ? null : raw.summary,
    findings: slug === 'discord-daemon' ? [] : findings,
    ...extra,
  }
  return { example, notes }
}

async function build(slug, raw, cover) {
  // Creator Dox: the Discord icon comes from the real Discord finding's invite.
  if (slug === 'creator-dox') {
    const d = raw.findings.map((f) => f.detail).find((x) => x?.invite || x?.invites?.length)
    const code = d?.invite?.code ?? d?.invites?.[0]?.code ?? /discord\.gg\/([\w-]+)/.exec(JSON.stringify(raw.findings))?.[1]
    raw = clone(raw)
    raw.discordCode = code
  }
  const { example, notes } = shape(slug, raw, cover)
  if (slug === 'creator-dox') {
    let icon = null
    try {
      const s = raw.discordCode ? await discordInvite(raw.discordCode) : null
      icon = s?.iconUrl ?? null
    } catch (e) { notes.push(`discord lookup failed: ${e.message}`) }
    if (icon) example.hero.push({ url: icon, caption: 'Official Discord' })
    else {
      // No Discord finding came out of the run (its invite data is the only allowed source), so the owner's Roblox avatar headshot stands in.
      const owner = raw.findings.map((f) => f.detail?.person).find((p) => p?.relation === 'owner' && p.userId)
      if (owner) {
        const r = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${owner.userId}&size=420x420&format=Png&isCircular=false`)
        const u = (await r.json())?.data?.[0]?.imageUrl
        if (u) {
          example.hero.push({ url: u, caption: `Owner (${owner.username})` })
          example.heroNote = `${GAME.name} and its owner ${owner.username}, the registered owner of the group that makes it, as the run found them.`
        }
      }
      notes.push('the run produced no Discord finding, so no invite icon: owner avatar headshot used')
    }
    notes.push(`discord invite code used: ${raw.discordCode ?? 'none'}`)
  }
  // privacy scan
  const text = JSON.stringify(example)
  const emails = text.match(new RegExp(EMAIL.source, 'g')) ?? []
  const mail = /mailto:/i.test(text)
  if (slug === 'content-creator-daemon' && (emails.length || mail)) notes.push(`EMAIL LEFT: ${emails.length} address(es), mailto=${mail}`)
  else if (emails.length) notes.push(`${emails.length} email-like strings (non content-creator): ${[...new Set(emails)].slice(0, 3).join(', ')}`)
  if (slug === 'hack-daemon') {
    const titles = new Set()
    for (const f of raw.findings) for (const v of f.detail.videos) if (v.title && v.title.length > 12) titles.add(v.title)
    const leaks = [...titles].filter((t) => text.includes(t))
    if (leaks.length) notes.push(`REAL VIDEO TITLE STILL PRESENT in ${leaks.length} place(s), e.g. in observed/cause/snippet`)
  }
  // hero must answer 200
  for (const h of example.hero) {
    if (h.url.startsWith('/')) {
      if (!existsSync(path.join(ROOT, 'public', h.url))) throw new Error(`Missing hero file ${h.url}`)
      continue
    }
    const st = await status(h.url)
    notes.push(`hero ${h.caption}: ${st} ${h.url}`)
    if (st !== 200) notes.push(`HERO NOT 200: ${h.url}`)
  }
  const file = path.join(OUT, `${slug}.json`)
  writeFileSync(file, JSON.stringify(example, null, 2) + '\n')
  const kb = (statSync(file).size / 1024).toFixed(1)
  return { kb, notes, example }
}

/* ---------------------------------------------------------------- main */
const g = await fetchGalleryUrls([GAME.universeId], 12)
const gallery = g.get(GAME.universeId) ?? []
if (!gallery.length) throw new Error('Roblox returned no gallery images')
const cover = gallery[0]
console.log(`cover: ${cover}  (${gallery.length} gallery images)`)

for (const slug of wanted) {
  const rawFile = path.join(RAW, `${slug}.json`)
  let raw
  const t0 = Date.now()
  if (rebuild && existsSync(rawFile)) raw = JSON.parse(readFileSync(rawFile, 'utf8'))
  else {
    log(slug, 'capturing')
    raw = await capture(slug, gallery)
    writeFileSync(rawFile, JSON.stringify(raw, null, 1))
  }
  const secs = Math.round((Date.now() - t0) / 1000)
  const { kb, notes, example } = await build(slug, raw, cover)
  log(slug, `written public/examples/${slug}.json  ${kb} KB  capturedAt ${example.capturedAt}  findings ${example.findings.length}  (${secs}s)`)
  for (const n of notes) log(slug, `  - ${n}`)
  log(slug, `  hero: ${example.hero.map((h) => `${h.caption}=${h.url}`).join(' | ')}`)
  log(slug, `  heroNote: ${example.heroNote}`)
}
console.log(`LLM calls ${llmCalls}, billed about $${llmCost.toFixed(4)}`)
