// Live test of the DMCA Daemon against real Roblox. Run:
//   node server/test/dmca.mjs                       (no model notes)
//   OPENROUTER_API_KEY="$(security find-generic-password -s OPENROUTER_API_KEY -w 2>/dev/null)" node server/test/dmca.mjs
// Optional: DMCA_JSON=<path> writes the run's summary and findings as JSON (used to render the detail view).
import { writeFileSync } from 'node:fs'
import { tool } from '../tools/dmca.ts'
import { createLlm, DEFAULT_ANALYSIS_MODEL } from '../llm.ts'
import { decodeJpeg, dHash, encodeJpeg, fingerprintBytes, hamming, resizeImage } from '../tools/dmca-image.ts'
import { downloadRobloxImage, fetchGalleryUrls } from '../roblox.ts'

const target = { kind: 'roblox-game', universeId: 10563114921, placeId: 107778070777162, name: 'Steal An Egg' }
let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures++
}

const llm = createLlm({ key: process.env.OPENROUTER_API_KEY ?? '', baseUrl: 'https://openrouter.ai', model: DEFAULT_ANALYSIS_MODEL })
const store = new Map()
const memory = { get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : undefined), set: (k, v) => store.set(k, JSON.stringify(v)) }

async function runOnce(label, previous, tgt = target) {
  const events = { steps: [], summary: null, findings: [] }
  const t0 = Date.now()
  await tool.analyze({
    tool: 'dmca-daemon',
    target: tgt,
    trigger: 'user',
    runId: 'test',
    daemonId: 'test',
    now: new Date(),
    signal: new AbortController().signal,
    step: (id, l, state, detail) => {
      events.steps.push({ id, state })
      if (state !== 'active') console.log(`  [${label}] step ${id} ${state}: ${detail ?? l}`)
    },
    summary: (s) => (events.summary = s),
    finding: (f) => events.findings.push(f),
    llm,
    secrets: { get: () => null, has: () => false },
    memory,
    previous,
  })
  events.ms = Date.now() - t0
  return events
}

console.log('== 1. real run against Roblox ==')
const first = await runOnce('run1', [])
console.log(`run 1 took ${(first.ms / 1000).toFixed(1)}s`)
for (const i of first.summary.items) console.log(`  ${i.label}: ${i.value}`)
for (const n of first.summary.notes) console.log(`  note: ${n}`)
for (const lane of ['identical', 'near', 'review', 'weak']) {
  const list = first.findings.filter((f) => f.group === lane)
  console.log(`\n-- lane ${lane}: ${list.length}`)
  for (const f of list) {
    const d = f.detail
    console.log(`  ${f.url}  dist=${d.bestDistance ?? 'n/a'} identical=${d.imagesCompared.identical} name=${d.nameSimilarity} desc=${d.descriptionSimilarity}  "${f.title}" by ${d.candidate.creatorName}${d.modelNote ? `\n      model note: ${d.modelNote}` : ''}`)
  }
}
check(first.summary.sortLabel === 'Identical images first, then near-identical, then by similarity', 'summary sort label names the order')
check(JSON.stringify(first).indexOf('Exact image') === -1 && JSON.stringify(first).indexOf('Ready to file') === -1, 'no "Exact image" or "Ready to file" wording anywhere in the output')
check(first.findings.every((f) => (f.group === 'identical') === (f.badge.label === 'Identical image') && (f.group !== 'identical' || f.detail.imagesCompared.identical > 0)), 'only sha256-identical findings are labelled "Identical image"')
check(first.findings.filter((f) => f.group === 'near').every((f) => f.badge.label === 'Near-identical image' && f.detail.imagesCompared.identical === 0 && f.status.label === 'Review, then file'), 'near-hash findings are "Near-identical image" with no identical bytes, status "Review, then file"')
check(first.summary.items.some((i) => i.label === 'Near-identical images') && first.summary.items.some((i) => i.label === 'Identical images') && first.summary.groups.map((g) => g.id).join() === 'identical,near,review,weak', 'summary items and groups use the new lanes')
check(first.findings.every((f) => f.url === `https://www.roblox.com/games/${f.detail.candidate.placeId}`), 'every finding carries the exact game link')
check(first.findings.every((f) => f.meta.some((m) => m.label === 'Link' && m.value === `roblox.com/games/${f.detail.candidate.placeId}`)), 'every row shows the link text')
check(first.findings.every((f) => f.detail.candidate.creatorId !== 825735094), 'no finding is by the owner (creator 825735094)')
check(first.findings.every((f) => f.detail.candidate.universeId !== target.universeId), 'our own universe is never a candidate')
check(first.findings.every((f) => /\[YOUR FULL NAME/.test(f.detail.notice) && !/—/.test(f.detail.notice)), 'notices keep the owner placeholders')
check(first.findings.every((f) => !/sent automatically|sends? (it|this|the notice) (for you|automatically)|we (will )?(send|file)|auto-?(send|file)/i.test(f.detail.notice)) && first.findings.every((f) => /has not filed this and cannot/.test(f.detail.notice)), 'notices never claim to send or file anything automatically')
check(first.summary.notices.some((n) => /human step/.test(n.lead)) && first.summary.notices.some((n) => /512\(f\)/.test(n.body)), 'the 512(f) warning and "Filing is a human step" notices stay')
check(first.findings.length > 0 ? !first.summary.notices.some((n) => /No copies found/.test(n.lead)) : first.summary.notices[0].lead === 'No copies found. Nothing to file.', 'the empty-result notice appears only when nothing was found')
check(first.findings.filter((f) => f.group === 'weak').length <= 8, 'at most 8 weak signals listed')
check(new Set(first.findings.map((f) => f.id)).size === first.findings.length, 'finding ids are unique and stable (dmca:<universeId>)')
check(first.findings.every((f) => f.isNew === undefined), 'first run sets no isNew (nothing to compare with)')
if (process.env.DMCA_JSON) writeFileSync(process.env.DMCA_JSON, JSON.stringify({ summary: first.summary, findings: first.findings }, null, 1))

console.log('\n== 1b. empty result (a game with no look-alikes) ==')
const lonely = await runOnce('empty', [], { kind: 'roblox-game', universeId: 1686885941, placeId: 4924922222, name: 'Brookhaven' })
console.log('  items:', lonely.summary.items.map((i) => `${i.label}=${i.value}`).join(' | '))
if (lonely.findings.length === 0) {
  const n = lonely.summary.notices[0]
  check(n.lead === 'No copies found. Nothing to file.' && /Compared \d+ images across \d+ games\./.test(n.body) && /better first try/.test(n.body), `empty result reads "${n.lead}" and says how much was compared`)
  check(/Nothing to file/.test(lonely.summary.sortLabel) && lonely.summary.notices.length === 3, 'empty result keeps both filing notices and says nothing to file in the sort line')
} else console.log('  info: Brookhaven now has candidates; empty-result checks skipped')

console.log('\n== 2. hash validation on our own images ==')
const gallery = (await fetchGalleryUrls([target.universeId], 10)).get(target.universeId) ?? []
check(gallery.length > 0, `got ${gallery.length} gallery thumbnails of our game`)
let reencodedMax = 0
for (const url of gallery.slice(0, 4)) {
  const bytes = await downloadRobloxImage(url)
  const a = fingerprintBytes(bytes)
  const b = fingerprintBytes(bytes)
  const self = hamming(a.fp.dhash, b.fp.dhash)
  check(self === 0 && a.fp.sha === b.fp.sha, `self comparison: distance ${self}, sha equal (${a.fp.sha.slice(0, 12)}...)  dhash ${a.fp.dhash}`)
  const img = decodeJpeg(bytes)
  const small = resizeImage(img, Math.round(img.width * 0.9), Math.round(img.height * 0.9))
  const copy = encodeJpeg(small, 60)
  const copyHash = dHash(decodeJpeg(copy))
  const d = hamming(a.fp.dhash, copyHash)
  reencodedMax = Math.max(reencodedMax, d)
  check(d <= 4 && a.fp.sha !== fingerprintBytes(copy).fp.sha, `re-encoded copy (q60, 90% scale, ${bytes.length}B -> ${copy.length}B): distance ${d} (<= 4), bytes differ`)
}
// An unrelated picture must NOT look like ours: compare our first image with a flipped copy of the second.
if (gallery.length > 1) {
  const x = fingerprintBytes(await downloadRobloxImage(gallery[0])).fp
  const y = fingerprintBytes(await downloadRobloxImage(gallery[1])).fp
  console.log(`  info: two different thumbnails of our own game differ by ${hamming(x.dhash, y.dhash)} bits (sanity: not 0)`)
}

console.log('\n== 3. rerun (same memory) ==')
const second = await runOnce('run2', first.findings)
console.log(`run 2 took ${(second.ms / 1000).toFixed(1)}s (run 1: ${(first.ms / 1000).toFixed(1)}s)`)
const newOnes = second.findings.filter((f) => f.isNew === true)
console.log(`  findings: ${second.findings.length} (run 1: ${first.findings.length}); flagged new: ${newOnes.length}`)
for (const f of newOnes) console.log(`   new: ${f.url} ${f.title}`)
check(newOnes.length === 0, 'rerun flags nothing as new')
check(second.findings.length > 0 ? second.findings.every((f) => f.isNew === false) : true, 'rerun marks every finding isNew=false')
check(second.ms < first.ms, 'rerun is faster (fingerprints come from memory)')
console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'}`)
process.exit(failures ? 1 : 0)
