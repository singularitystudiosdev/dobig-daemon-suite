// End-to-end checks against a running dev server + mock-gemini (no real Google calls).
//   node server/test/mock-gemini.mjs & DAEMON_CACHE_DIR=$(mktemp -d) GEMINI_API_KEY=test-ok GEMINI_BASE_URL=http://127.0.0.1:5199 vite --port 5192 &
//   node server/test/smoke.mjs live   |   (server started WITHOUT a key, same DAEMON_CACHE_DIR=$(mktemp -d) and GEMINI_BASE_URL)  node server/test/smoke.mjs nokey
//   OpenRouter-only server (no Gemini key):  DAEMON_CACHE_DIR=$(mktemp -d) OPENROUTER_API_KEY=test-or-ok OPENROUTER_BASE_URL=http://127.0.0.1:5199 vite --host 127.0.0.1 --port 5192 &  node server/test/smoke.mjs orenv
//   Both keys set (Gemini wins):             GEMINI_API_KEY=test-ok GEMINI_BASE_URL=http://127.0.0.1:5199 OPENROUTER_API_KEY=test-or-ok OPENROUTER_BASE_URL=http://127.0.0.1:5199 vite ...  node server/test/smoke.mjs both
// The `live` server also needs OPENROUTER_BASE_URL=http://127.0.0.1:5199 (header keys beginning with sk-or- go to OpenRouter's /api/v1/images, served by the same mock).
// Env vars read by the server: GEMINI_API_KEY, GEMINI_BASE_URL, OPENROUTER_API_KEY, OPENROUTER_BASE_URL, DAEMON_CACHE_DIR.
// Refuse to run against a server that could write into the live image cache (<repo>/.cache/variants).
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const LIVE_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'variants')
if (!process.env.DAEMON_CACHE_DIR || resolve(process.env.DAEMON_CACHE_DIR) === LIVE_CACHE) {
  console.error('Refusing to run: set DAEMON_CACHE_DIR to a temp dir (not .cache/variants) and start the server with the same one, e.g. DAEMON_CACHE_DIR=$(mktemp -d).')
  process.exit(2)
}
const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'
const MOCK = process.env.MOCK ?? 'http://127.0.0.1:5199'
const phase = process.argv[2] ?? 'live'
// An OpenRouter header key must start with this prefix; the rest is an obviously fake test token (the mock ignores the prefix).
const OR_PREFIX = 'sk-or-'
const orKey = (name) => OR_PREFIX + name
const SYNTH_MANY = Array.from({ length: 12 }, (_, i) => ({ id: String(900000 + i), url: 'https://tr.rbxcdn.com/180DAY-1e742eea0123525631cc6b21b4f77efc/768/432/Image/Jpeg/noFilter' }))
const PROMPT = 'Make a variant of this thumbnail with a novel perspective'
let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const getJson = async (path, init) => {
  const r = await fetch(BASE + path, init)
  return { status: r.status, headers: r.headers, body: await r.json() }
}
const mock = async (p = '/__stats') => (await fetch(MOCK + p)).json()

// Credits are charged server-side (250 per tile); keep the thumbnail balance topped up so the stream tests below run.
// Start the server with DAEMON_DATA_DIR=$(mktemp -d) so the balance starts fresh.
async function fund(min = 9000) {
  for (let i = 0; i < 20; i++) {
    const c = await (await fetch(BASE + '/api/credits')).json()
    if (c.balances['thumbnail-daemon'] >= min) return c.balances['thumbnail-daemon']
    await fetch(BASE + '/api/credits/topup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'thumbnail-daemon' }) })
  }
}
const balance = async () => (await (await fetch(BASE + '/api/credits')).json()).balances['thumbnail-daemon']

async function stream(body, headers = {}, { abortAfterMs, noFund } = {}) {
  if (!noFund) await fund()
  const ac = new AbortController()
  if (abortAfterMs) setTimeout(() => ac.abort(), abortAfterMs)
  const r = await fetch(BASE + '/api/variants', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal })
  const events = []
  let blank = 0
  if (r.headers.get('content-type')?.includes('ndjson')) {
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
  } else events.push(await r.json())
  return { r, events, blank }
}

const status = await getJson('/api/status')
console.log('status', JSON.stringify(status.body))

if (phase === 'live') {
  check('status geminiKey true', status.body.geminiKey === true)
  check('status model/perThumb', status.body.model === 'gemini-nano-banana-2.1' && status.body.perThumb === 3)
  check('status fields exactly geminiKey,llm,model,perThumb,provider', Object.keys(status.body).sort().join() === 'geminiKey,llm,model,perThumb,provider', Object.keys(status.body).join())
  check('status provider google (env Gemini key)', status.body.provider === 'google')

  // ---- /api/game
  const g = await getJson('/api/game?link=' + encodeURIComponent('https://www.roblox.com/games/107778070777162/Steal-An-Egg'))
  check('game resolves', g.status === 200 && g.body.ok === true, `${g.body.game?.name} universe=${g.body.game?.universeId} gallery=${g.body.gallery?.length}`)
  check('universe 10563114921', g.body.game?.universeId === 10563114921)
  check('4 gallery images, all tr.rbxcdn.com', g.body.gallery?.length === 4 && g.body.gallery.every((t) => /^https:\/\/tr\.rbxcdn\.com\//.test(t.url) && /^\d+$/.test(t.id)))
  check('cover = first gallery image', g.body.game?.cover === g.body.gallery?.[0]?.url)
  const gallery = g.body.gallery ?? []

  // ---- credits: charged before the stream, refunded per failed tile, 402 before any stream byte
  {
    await fund(1000)
    const b0 = await balance()
    const ok = await stream({ gallery: gallery.slice(0, 1) }, {}, { noFund: true })
    const b1 = await balance()
    check('credits: a 3-tile stream that succeeds spends 750', ok.events.filter((e) => e.type === 'done').length === 3 && b0 - b1 === 750, `${b0} -> ${b1}`)
    const bad = await stream({ gallery: gallery.slice(0, 1) }, { 'x-gemini-key': 'test-badkey' }, { noFund: true })
    const b2 = await balance()
    check('credits: failed tiles are refunded (balance unchanged)', bad.events.filter((e) => e.type === 'failed').length === 3 && b2 === b1, `${b1} -> ${b2}`)
    let bal = await balance()
    for (let i = 0; i < 20 && bal >= 9000; i++) {
      await stream({ gallery: gallery.slice(0, 1) }, {}, { noFund: true })
      bal = await balance()
    }
    const many = [...gallery, ...SYNTH_MANY].slice(0, 12)
    const over = await stream({ gallery: many }, {}, { noFund: true })
    const need = many.length * 3 * 250
    check('credits: over-budget request is 402 JSON with needed and balance, before any stream bytes', over.r.status === 402 && /json/.test(over.r.headers.get('content-type')) && over.events[0].ok === false && over.events[0].code === 'credits' && over.events[0].needed === need && over.events[0].balance === bal, JSON.stringify(over.events[0]))
    check('credits: the 402 charged nothing', (await balance()) === bal)
    const ex = await getJson(`/api/variants/existing?ids=${gallery.map((t) => t.id).join(',')},999`)
    const first = ex.body.variants?.filter((v) => v.thumbId === gallery[0].id) ?? []
    check('variants/existing lists generated files (read-only)', ex.status === 200 && ex.body.ok === true && first.length === 3 && first.every((v) => /^\/api\/img\/\d+-[0-2]\.(jpg|png|webp)\?v=\d+$/.test(v.src)) && !ex.body.variants.some((v) => v.thumbId === '999'), JSON.stringify(ex.body).slice(0, 200))
    const img = await fetch(BASE + first[0].src)
    check('variants/existing src is served by /api/img', img.status === 200 && img.headers.get('content-type') === 'image/jpeg')
    check('variants/existing with no ids is an empty list', JSON.stringify((await getJson('/api/variants/existing')).body) === JSON.stringify({ ok: true, variants: [] }))
  }

  const variants = [
    ['locale + start link', '/api/game?link=' + encodeURIComponent('https://web.roblox.com/en/games/107778070777162'), 200],
    ['bare numeric place id', '/api/game?link=107778070777162', 200],
  ]
  for (const [name, url, st] of variants) {
    const r = await getJson(url)
    check(`game: ${name}`, r.status === st && r.body.game?.universeId === 10563114921, `status=${r.status}`)
  }
  const start = await getJson('/api/game?link=' + encodeURIComponent('https://www.roblox.com/games/start?placeId=107778070777162'))
  check('game: games/start?placeId=', start.status === 200 && start.body.game?.universeId === 10563114921)

  const junk = await getJson('/api/game?link=' + encodeURIComponent('hello world'))
  check('junk -> 400 bad-link', junk.status === 400 && junk.body.code === 'bad-link', junk.body.message)
  const empty = await getJson('/api/game')
  check('missing link -> 400 bad-link', empty.status === 400 && empty.body.code === 'bad-link')
  const other = await getJson('/api/game?link=' + encodeURIComponent('https://example.com/games/123'))
  check('foreign host -> 400 bad-link', other.status === 400 && other.body.code === 'bad-link')
  const share = await getJson('/api/game?link=' + encodeURIComponent('https://www.roblox.com/share?code=abc123&type=ExperienceDetails'))
  check('share link -> bad-link with exact message', share.status === 400 && share.body.code === 'bad-link' && share.body.message === "Share links can't be opened without a Roblox login. Paste the roblox.com/games/... link instead.")
  const nf = await getJson('/api/game?link=1')
  check('garbage place id -> 404 not-found', nf.status === 404 && nf.body.code === 'not-found', nf.body.message)
  const ro = await getJson('/api/game?link=' + encodeURIComponent('https://ro.blox.com/Ebh5?pid=share&is_retargeting=true&af_dp=roblox%3A%2F%2Fnavigation%2Fgame_details%3FgameId%3D107778070777162'))
  console.log('ro.blox.com result:', ro.status, JSON.stringify(ro.body).slice(0, 200))

  // ---- /api/variants (mock Gemini)
  await mock('/__reset')
  const t0 = Date.now()
  const ok = await stream({ gallery })
  const ev = ok.events
  check('variants content-type ndjson + headers', ok.r.headers.get('content-type')?.startsWith('application/x-ndjson') && ok.r.headers.get('cache-control') === 'no-cache' && ok.r.headers.get('x-accel-buffering') === 'no')
  check('first event start/live/total 12', ev[0]?.type === 'start' && ev[0].mode === 'live' && ev[0].total === 12 && ev[0].model === 'gemini-nano-banana-2.1', JSON.stringify(ev[0]))
  check('start.provider google for the env Gemini key', ev[0]?.provider === 'google')
  const done = ev.filter((e) => e.type === 'done')
  check('12 done, no source field', done.length === 12 && done.every((e) => !('source' in e) && /^\/api\/img\/\d+-\d\.jpg\?v=\d+$/.test(e.src)))
  check('last event end done=12 failed=0', ev.at(-1)?.type === 'end' && ev.at(-1).done === 12 && ev.at(-1).failed === 0, `${Date.now() - t0}ms`)
  const st = await mock()
  check('mock got 12 calls, exact prompt each time', st.calls === 12 && st.prompts.every((p) => p === PROMPT))
  check('mock max concurrency <= 3 (and reached 3)', st.maxConcurrent <= 3 && st.maxConcurrent === 3, `max=${st.maxConcurrent}`)
  check('mock received a JPEG image part', st.images.every((i) => i.mime === 'image/jpeg' && i.bytes > 1000), JSON.stringify(st.images[0]))
  check('imageConfig 16:9 / 1K sent', st.images[0].cfg?.imageConfig?.aspectRatio === '16:9' && st.images[0].cfg?.imageConfig?.imageSize === '1K')
  const img = await fetch(BASE + done[0].src)
  check('/api/img serves jpeg immutable', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && /immutable/.test(img.headers.get('cache-control') ?? '') && (await img.arrayBuffer()).byteLength > 1000)

  // Nothing is served from an earlier run: an identical second run calls the model for every tile again.
  const again = await stream({ gallery })
  const st2 = await mock()
  check('second identical run: 12 live done, mock now at 24 calls', again.events.filter((e) => e.type === 'done').length === 12 && st2.calls === 24, `calls=${st2.calls}`)
  const hadSrc = new Set(done.map((e) => `${e.thumbId}-${e.index}`))
  check('second run covers the same 12 tiles', again.events.filter((e) => e.type === 'done').every((e) => hadSrc.has(`${e.thumbId}-${e.index}`)))

  await mock('/__reset')
  const hdrGoogle = await stream({ gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }, { 'x-gemini-key': 'test-ok' })
  check('start.provider google for header key test-ok', hdrGoogle.events[0]?.provider === 'google' && hdrGoogle.events.some((e) => e.type === 'done'))

  // a stale `fresh` flag is ignored and still generates live
  await mock('/__reset')
  const fr = await stream({ gallery: gallery.slice(0, 1), fresh: true })
  check('body with fresh:true accepted, 3 live calls', fr.r.status === 200 && fr.events[0].mode === 'live' && fr.events.filter((e) => e.type === 'done').length === 3 && (await mock()).calls === 3)

  // only
  await mock('/__reset')
  const only = await stream({ gallery, only: [{ thumbId: gallery[1].id, index: 2 }] })
  check('only: total 1, exactly one tile emitted', only.events[0].total === 1 && only.events.filter((e) => e.type === 'done').length === 1 && only.events.filter((e) => e.type === 'working').length === 1 && only.events.find((e) => e.type === 'done').thumbId === gallery[1].id && only.events.find((e) => e.type === 'done').index === 2)

  // modality retry
  await mock('/__reset')
  const mod = await stream({ gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }, { 'x-gemini-key': 'test-modality' })
  check('modality 400 -> retried with TEXT+IMAGE -> done', mod.events.filter((e) => e.type === 'done').length === 1, `calls=${(await mock()).calls} (expect 2: IMAGE rejected, then TEXT+IMAGE)`)

  // interactions fallback
  await mock('/__reset')
  const inter = await stream({ gallery: gallery.slice(0, 1) }, { 'x-gemini-key': 'test-interactions' })
  const ist = await mock()
  check('interactions fallback: 3 done', inter.events.filter((e) => e.type === 'done').length === 3, `routes=${[...new Set(ist.routes)]}`)
  check('interactions body carried exact prompt', ist.routes.includes('interactions') && ist.prompts.every((p) => p === PROMPT))
  // blocked
  await mock('/__reset')
  const blk = await stream({ gallery: gallery.slice(0, 1) }, { 'x-gemini-key': 'test-block' })
  const bf = blk.events.filter((e) => e.type === 'failed')
  check('promptFeedback block -> 3 failed reason blocked, stream ends', bf.length === 3 && bf.every((e) => e.reason === 'blocked') && blk.events.at(-1).type === 'end' && blk.events.at(-1).failed === 3, bf[0]?.message)
  const fin = await stream({ gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }, { 'x-gemini-key': 'test-finish' })
  check('finishReason IMAGE_SAFETY -> blocked', fin.events.find((e) => e.type === 'failed')?.reason === 'blocked')
  const noi = await stream({ gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }, { 'x-gemini-key': 'test-noimage' })
  check('NO_IMAGE -> no-image', noi.events.find((e) => e.type === 'failed')?.reason === 'no-image')
  const bad = await stream({ gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }, { 'x-gemini-key': 'test-badkey' })
  const badf = bad.events.find((e) => e.type === 'failed')
  check('API_KEY_INVALID -> no-key, key not echoed', badf?.reason === 'no-key' && !JSON.stringify(bad.events).includes('test-badkey'), badf?.message)

  // 429 then success
  await mock('/__reset')
  const t429 = Date.now()
  const rl = await stream({ gallery: gallery.slice(0, 2) }, { 'x-gemini-key': 'test-429' })
  const rst = await mock()
  check('429 then success: all 6 done after retry', rl.events.filter((e) => e.type === 'done').length === 6 && rst.calls > 6, `calls=${rst.calls} ${Date.now() - t429}ms`)
  const rl2 = await stream({ gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }, { 'x-gemini-key': 'test-429-always' })
  const rf = rl2.events.find((e) => e.type === 'failed')
  const rst2 = await mock()
  check('429 forever -> failed rate-limited after 3 attempts', rf?.reason === 'rate-limited' && rst2.calls >= 3, rf?.message)

  // ---- OpenRouter (header key beginning with sk-or-; mock endpoint POST /api/v1/images)
  const one = { gallery: gallery.slice(0, 1), only: [{ thumbId: gallery[0].id, index: 0 }] }
  await mock('/__reset')
  const orOk = await stream({ gallery }, { 'x-gemini-key': orKey('test-or-ok') })
  const ors = await mock()
  const orDone = orOk.events.filter((e) => e.type === 'done')
  check('OR: start.provider openrouter, model stays NANO_BANANA_MODEL', orOk.events[0]?.type === 'start' && orOk.events[0].provider === 'openrouter' && orOk.events[0].mode === 'live' && orOk.events[0].model === 'gemini-nano-banana-2.1', JSON.stringify(orOk.events[0]))
  check('OR: 12 done, end done=12 failed=0', orDone.length === 12 && orOk.events.at(-1)?.type === 'end' && orOk.events.at(-1).done === 12 && orOk.events.at(-1).failed === 0 && orDone.every((e) => /^\/api\/img\/\d+-\d\.jpg\?v=\d+$/.test(e.src)))
  check('OR: mock saw 12 /api/v1/images calls and 0 Google calls', ors.openrouter.calls === 12 && ors.calls === 0, `or=${ors.openrouter.calls} google=${ors.calls}`)
  check('OR: exact prompt every call', ors.openrouter.prompts.every((p) => p === PROMPT))
  check('OR: model google/gemini-nano-banana-2.1, 16:9, 1K, one jpeg data-URL reference', ors.openrouter.images.every((i) => i.model === 'google/gemini-nano-banana-2.1' && i.aspect_ratio === '16:9' && i.resolution === '1K' && i.mime === 'image/jpeg' && i.bytes > 1000 && i.refs === 1), JSON.stringify(ors.openrouter.images[0]))
  check('OR: bearer is the header key on every call', ors.openrouter.keys.every((k) => k === orKey('test-or-ok')))
  check('OR: concurrency reached 3, never above', ors.openrouter.maxConcurrent === 3, `max=${ors.openrouter.maxConcurrent}`)
  const orImg = await fetch(BASE + orDone[0].src)
  check('OR: /api/img serves the generated jpeg', orImg.status === 200 && orImg.headers.get('content-type') === 'image/jpeg' && (await orImg.arrayBuffer()).byteLength > 1000)
  const orOnly = await stream({ gallery, only: [{ thumbId: gallery[1].id, index: 2 }] }, { 'x-gemini-key': orKey('test-or-ok') })
  check('OR: only -> exactly one tile', orOnly.events[0].total === 1 && orOnly.events.filter((e) => e.type === 'done').length === 1)

  for (const [name, key, reason, test] of [
    ['401', 'test-or-401', 'no-key', (m) => m === 'OpenRouter rejected the API key. Check the key and try again.'],
    ['402', 'test-or-402', 'upstream', (m) => m === 'Your OpenRouter account is out of credits. Add credits at openrouter.ai/credits.'],
    ['moderation 400', 'test-or-moderation', 'blocked', (m) => m === 'Google declined to edit this thumbnail (safety filter). Try another screenshot.'],
    ['empty data', 'test-or-empty', 'no-image', (m) => /returned no image/.test(m)],
  ]) {
    await mock('/__reset')
    const r = await stream(name === '401' ? { gallery: gallery.slice(0, 1) } : one, { 'x-gemini-key': orKey(key) })
    const fs_ = r.events.filter((e) => e.type === 'failed')
    const want = name === '401' ? 3 : 1
    const text = JSON.stringify(r.events)
    check(`OR: ${name} -> ${want} failed ${reason}, stream ends, key not echoed`, fs_.length === want && fs_.every((e) => e.reason === reason && test(e.message)) && r.events.at(-1)?.type === 'end' && !text.includes(orKey(key)) && !text.includes(key), fs_[0]?.message)
  }
  await mock('/__reset')
  const t429or = Date.now()
  const or429 = await stream({ gallery: gallery.slice(0, 2) }, { 'x-gemini-key': orKey('test-or-429') })
  const or429s = await mock()
  check('OR: 429 (Retry-After) then success: all 6 done after retry', or429.events.filter((e) => e.type === 'done').length === 6 && or429s.openrouter.calls > 6, `calls=${or429s.openrouter.calls} ${Date.now() - t429or}ms`)

  // Direct unit check of the key-prefix selection (no network).
  try {
    const { providerForKey } = await import('../variants.ts')
    check('providerForKey: sk-or- prefix -> openrouter, AIza.. and test-or-ok -> google', providerForKey(orKey('x')) === 'openrouter' && providerForKey('AIza-example') === 'google' && providerForKey('test-or-ok') === 'google')
  } catch (err) {
    console.log('note: could not import server/variants.ts for the selection unit check:', String(err).slice(0, 120))
  }

  // abort
  await mock('/__reset')
  const ab = await stream({ gallery }, { 'x-gemini-key': 'test-slow' }, { abortAfterMs: 1500 })
  await new Promise((r) => setTimeout(r, 800))
  const ast = await mock()
  check('client abort cancels in-flight (3 upstream aborted, no 4th call)', ast.aborted === 3 && ast.calls === 3 && ast.concurrent === 0, `calls=${ast.calls} aborted=${ast.aborted} concurrent=${ast.concurrent}`)

  // validation
  const evil = await stream({ gallery: [{ id: '1', url: 'https://evil.example.com/a.jpg' }] })
  check('non-rbxcdn url rejected 400', evil.r.status === 400 && evil.events[0].ok === false, evil.events[0].message)
  const evil2 = await stream({ gallery: [{ id: '1', url: 'http://tr.rbxcdn.com/a.jpg' }] })
  check('http (non-https) rejected', evil2.r.status === 400)
  const evil3 = await stream({ gallery: [{ id: '1', url: 'https://tr.rbxcdn.com.evil.com/a.jpg' }] })
  check('lookalike host rejected', evil3.r.status === 400)
  const evil4 = await stream({ gallery: [{ id: '1', url: 'https://tr.rbxcdn.com@evil.com/a.jpg' }] })
  check('userinfo trick rejected', evil4.r.status === 400)
  const nid = await stream({ gallery: [{ id: '12a', url: 'https://tr.rbxcdn.com/x' }] })
  check('non-digit id rejected', nid.r.status === 400)
  const none = await stream({ gallery: [] })
  check('empty gallery rejected', none.r.status === 400)
  const many = await stream({ gallery: Array.from({ length: 13 }, (_, i) => ({ id: String(i + 1), url: 'https://tr.rbxcdn.com/x' })) })
  check('13 thumbs rejected', many.r.status === 400)
  const big = await fetch(BASE + '/api/variants', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gallery: gallery.slice(0, 1), pad: 'x'.repeat(300_000) }) })
  check('>256KB body rejected 413', big.status === 413)
  const nj = await fetch(BASE + '/api/variants', { method: 'POST', body: '{nope' })
  check('invalid JSON -> 400', nj.status === 400)

  // /api/img validation
  for (const [name, p, want] of [
    ['img traversal', '/api/img/..%2F..%2Fpackage.json', 404],
    ['img bad ext', '/api/img/1-0.gif', 404],
    ['img missing', '/api/img/999-0.jpg', 404],
  ]) {
    const r = await fetch(BASE + p)
    check(name, r.status === want, `status=${r.status}`)
  }
}

if (phase === 'nokey') {
  check('status geminiKey false', status.body.geminiKey === false)
  check('status provider null, fields exactly geminiKey,llm,model,perThumb,provider', status.body.provider === null && Object.keys(status.body).sort().join() === 'geminiKey,llm,model,perThumb,provider', Object.keys(status.body).join())
  await mock('/__reset')
  // A made-up id and a real Steal An Egg gallery (when Roblox is reachable): both unavailable, neither touches the mock.
  const galleries = [[{ id: '424242', url: 'https://tr.rbxcdn.com/180DAY-1e742eea0123525631cc6b21b4f77efc/768/432/Image/Jpeg/noFilter' }]]
  const g = await getJson('/api/game?link=' + encodeURIComponent('https://www.roblox.com/games/107778070777162/Steal-An-Egg'))
  if (g.body.gallery?.length) galleries.push(g.body.gallery)
  else console.log('note: Steal An Egg gallery unavailable (Roblox unreachable); only the synthetic gallery was tested')
  for (const gallery of galleries) {
    const total = gallery.length * 3
    const r = await stream({ gallery })
    const f = r.events.filter((e) => e.type === 'failed')
    check(`start mode unavailable, provider null (${gallery.length} thumb)`, r.events[0].type === 'start' && r.events[0].mode === 'unavailable' && r.events[0].provider === null && r.events[0].total === total)
    check(`${total} failed no-key with exact message`, f.length === total && f.every((e) => e.reason === 'no-key' && e.message === 'Add a Gemini API key to generate variants for this game.'))
    check(`end done=0 failed=${total}`, r.events.at(-1).type === 'end' && r.events.at(-1).done === 0 && r.events.at(-1).failed === total)
  }
  const fr = await stream({ gallery: galleries[0], fresh: true })
  check('fresh:true without a key is still unavailable', fr.events[0].mode === 'unavailable' && fr.events.filter((e) => e.type === 'done').length === 0)
  check('mock received 0 calls without a key', (await mock()).calls === 0)
  const hk = await stream({ gallery: galleries[0] }, { 'x-gemini-key': 'test-ok' })
  check('header key makes mode live without env key', hk.events[0].mode === 'live' && hk.events[0].provider === 'google' && hk.events.filter((e) => e.type === 'done').length === 3)
}

const SYNTH = [{ id: '424242', url: 'https://tr.rbxcdn.com/180DAY-1e742eea0123525631cc6b21b4f77efc/768/432/Image/Jpeg/noFilter' }]
if (phase === 'orenv') {
  // Server env has OPENROUTER_API_KEY=test-or-ok (+ OPENROUTER_BASE_URL at the mock) and NO Gemini key.
  check('status: geminiKey true, provider openrouter, fields', status.body.geminiKey === true && status.body.provider === 'openrouter' && status.body.model === 'gemini-nano-banana-2.1' && Object.keys(status.body).sort().join() === 'geminiKey,llm,model,perThumb,provider', JSON.stringify(status.body))
  await mock('/__reset')
  const r = await stream({ gallery: SYNTH })
  const st = await mock()
  check('keyless header generates through OpenRouter (3 done, provider openrouter)', r.events[0].mode === 'live' && r.events[0].provider === 'openrouter' && r.events.filter((e) => e.type === 'done').length === 3 && st.openrouter.calls === 3 && st.calls === 0, `or=${st.openrouter.calls} google=${st.calls}`)
  check('env key sent as bearer, exact prompt, 16:9 / 1K', st.openrouter.keys.every((k) => k === 'test-or-ok') && st.openrouter.prompts.every((p) => p === PROMPT) && st.openrouter.images.every((i) => i.aspect_ratio === '16:9' && i.resolution === '1K' && i.model === 'google/gemini-nano-banana-2.1'))
}
if (phase === 'both') {
  check('status with both env keys: geminiKey true, provider google', status.body.geminiKey === true && status.body.provider === 'google', JSON.stringify(status.body))
  await mock('/__reset')
  const r = await stream({ gallery: SYNTH })
  const st = await mock()
  check('keyless header with both env keys generates through Google', r.events[0].provider === 'google' && r.events.filter((e) => e.type === 'done').length === 3 && st.calls === 3 && st.openrouter.calls === 0, `google=${st.calls} or=${st.openrouter.calls}`)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
