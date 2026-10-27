// Offline proof of the standalone server: access gate, CORS, rate limit, static files, shutdown.
// Run: node server/test/gate.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../standalone.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dobig-gate-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>suite</title>')
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)')
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'outside dist')
const env = { API_ACCESS_CODE: 'test-code', CORS_ORIGIN: 'https://example.test', DAEMON_DATA_DIR: path.join(tmp, 'data'), DAEMON_CACHE_DIR: path.join(tmp, 'cache') }

let passed = 0
const check = (name, fn) => Promise.resolve(fn()).then(() => void passed++, (err) => { console.error(`FAIL ${name}\n`, err.message); process.exitCode = 1; throw err })

/** Raw request, so the path reaches the server exactly as written (fetch would normalise `..`). */
const raw = (port, pathname, headers = {}, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })

let running
try {
  await check('refuses to start without a code', async () => {
    await assert.rejects(startServer({ env: { ...env, API_ACCESS_CODE: '' }, distDir: dist, port: 0, host: '127.0.0.1' }), /API_ACCESS_CODE/)
  })

  running = await startServer({ env, distDir: dist, root: tmp, port: 0, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${running.port}`
  const auth = (code) => ({ authorization: `Bearer ${code}` })

  await check('401 without a code', async () => {
    const res = await fetch(`${base}/api/credits`)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { ok: false, code: 'access', message: 'Enter the access code to use this server.' })
  })
  await check('401 with a wrong code', async () => {
    assert.equal((await fetch(`${base}/api/credits`, { headers: auth('nope') })).status, 401)
  })
  await check('200 with the code', async () => {
    const res = await fetch(`${base}/api/credits`, { headers: auth('test-code') })
    assert.equal(res.status, 200)
    assert.equal(typeof (await res.json()), 'object')
  })
  await check('status is open and reports the gate', async () => {
    const res = await fetch(`${base}/api/status`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.accessRequired, true)
    assert.equal(body.requestsWebhook, false)
  })
  await check('preflight from the allowed origin', async () => {
    const res = await raw(running.port, '/api/daemons', { origin: 'https://example.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' }, 'OPTIONS')
    assert.equal(res.status, 204)
    assert.equal(res.headers['access-control-allow-origin'], 'https://example.test')
    assert.match(res.headers['access-control-allow-headers'], /authorization/)
    assert.match(res.headers['access-control-allow-methods'], /PATCH/)
  })
  await check('preflight from another origin gets no CORS headers', async () => {
    const res = await raw(running.port, '/api/daemons', { origin: 'https://evil.test', 'access-control-request-method': 'POST' }, 'OPTIONS')
    assert.equal(res.headers['access-control-allow-origin'], undefined)
    assert.equal(res.headers['access-control-allow-methods'], undefined)
  })
  await check('a real response echoes the origin', async () => {
    const res = await raw(running.port, '/api/credits', { ...auth('test-code'), origin: 'https://example.test' })
    assert.equal(res.status, 200)
    assert.equal(res.headers['access-control-allow-origin'], 'https://example.test')
  })
  await check('static index at / and SPA fallback', async () => {
    const root = await fetch(`${base}/`)
    assert.equal(root.status, 200)
    assert.match(root.headers.get('content-type'), /text\/html/)
    assert.match(await root.text(), /<title>suite<\/title>/)
    const deep = await fetch(`${base}/some/where`)
    assert.equal(deep.status, 200)
    assert.match(await deep.text(), /<title>suite<\/title>/)
    const asset = await fetch(`${base}/assets/app-abc123.js`)
    assert.match(asset.headers.get('content-type'), /javascript/)
    assert.match(asset.headers.get('cache-control'), /immutable/)
    assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404)
  })
  await check('traversal is refused', async () => {
    for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt']) {
      const res = await raw(running.port, p)
      assert.equal(res.status, 403, p)
      assert.ok(!res.text.includes('outside dist'), p)
    }
  })
  await check('ten wrong codes then 429, even for the right code', async () => {
    let wrong = 1 // the wrong code above already counted
    let status = 0
    for (let i = 0; i < 12 && status !== 429; i++) {
      status = (await fetch(`${base}/api/credits`, { headers: auth(`wrong-${i}`) })).status
      if (status === 401) wrong++
    }
    assert.equal(status, 429)
    assert.equal(wrong, 10)
    assert.equal((await fetch(`${base}/api/credits`, { headers: auth('test-code') })).status, 429)
    assert.equal((await fetch(`${base}/api/status`)).status, 200)
  })
  await check('stop works', async () => {
    await running.close()
    running = null
    await assert.rejects(fetch(`${base}/api/status`))
  })
  console.log(`gate: ${passed} checks passed`)
} finally {
  await running?.close().catch(() => undefined)
  fs.rmSync(tmp, { recursive: true, force: true })
}
