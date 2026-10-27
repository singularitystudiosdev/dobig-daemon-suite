// End-to-end checks against a running dev server + mock-gemini (no real Google calls).
//   node server/test/mock-gemini.mjs & DAEMON_CACHE_DIR=$(mktemp -d) GEMINI_API_KEY=test-ok GEMINI_BASE_URL=http://127.0.0.1:5199 vite --port 5192 &
//   node server/test/smoke.mjs live   |   (server started WITHOUT a key, same DAEMON_CACHE_DIR=$(mktemp -d) and GEMINI_BASE_URL)  node server/test/smoke.mjs nokey
const BASE = process.env.BASE ?? 'http://127.0.0.1:5192'
const MOCK = process.env.MOCK ?? 'http://127.0.0.1:5199'
const phase = process.argv[2] ?? 'live'
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

async function stream(body, headers = {}, { abortAfterMs } = {}) {
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
  check('status has no recorded field', !('recorded' in status.body) && Object.keys(status.body).sort().join() === 'geminiKey,model,perThumb', Object.keys(status.body).join())

  // ---- /api/game
  const g = await getJson('/api/game?link=' + encodeURIComponent('https://www.roblox.com/games/107778070777162/Steal-An-Egg'))
  check('game resolves', g.status === 200 && g.body.ok === true, `${g.body.game?.name} universe=${g.body.game?.universeId} gallery=${g.body.gallery?.length}`)
  check('universe 10563114921', g.body.game?.universeId === 10563114921)
  check('4 gallery images, all tr.rbxcdn.com', g.body.gallery?.length === 4 && g.body.gallery.every((t) => /^https:\/\/tr\.rbxcdn\.com\//.test(t.url) && /^\d+$/.test(t.id)))
  check('cover = first gallery image', g.body.game?.cover === g.body.gallery?.[0]?.url)
  const gallery = g.body.gallery ?? []

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
  check('status has no recorded field', !('recorded' in status.body) && Object.keys(status.body).sort().join() === 'geminiKey,model,perThumb', Object.keys(status.body).join())
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
    check(`start mode unavailable (${gallery.length} thumb)`, r.events[0].type === 'start' && r.events[0].mode === 'unavailable' && r.events[0].total === total)
    check(`${total} failed no-key with exact message`, f.length === total && f.every((e) => e.reason === 'no-key' && e.message === 'Add a Gemini API key to generate variants for this game.'))
    check(`end done=0 failed=${total}`, r.events.at(-1).type === 'end' && r.events.at(-1).done === 0 && r.events.at(-1).failed === total)
  }
  const fr = await stream({ gallery: galleries[0], fresh: true })
  check('fresh:true without a key is still unavailable', fr.events[0].mode === 'unavailable' && fr.events.filter((e) => e.type === 'done').length === 0)
  check('mock received 0 calls without a key', (await mock()).calls === 0)
  const hk = await stream({ gallery: galleries[0] }, { 'x-gemini-key': 'test-ok' })
  check('header key makes mode live without env key', hk.events[0].mode === 'live' && hk.events.filter((e) => e.type === 'done').length === 3)
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
