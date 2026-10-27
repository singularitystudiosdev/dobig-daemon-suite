// A small MOCK of the two Roblox Open Cloud endpoints the Description Daemon uses. It is not Roblox: every number it
// returns is synthetic and exists only so the client code paths can be exercised without an owner's key.
//   POST /analytics-query-api/v1/universes/{id}/metrics   async submit: 200 immediately, or 202 + path, or one 429 with retry-after
//   GET  /analytics-query-api/{path}                       poll: done:false once, then done:true with data points
//   PATCH /cloud/v2/universes/{id}?updateMask=description  stores the description, answers the Universe resource
// It checks what the official docs require: x-api-key header, JSON body fields, RFC 3339 times, updateMask.
//
//   import { startMockOpenCloud } from './mock-opencloud.mjs'; const m = await startMockOpenCloud({ apiKey: 'mock-key' })
//   process.env.ROBLOX_OPEN_CLOUD_BASE = m.url
import http from 'node:http'

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

export async function startMockOpenCloud({ apiKey = 'mock-key', port = 0 } = {}) {
  const calls = []
  const ops = new Map()
  const universes = new Map()
  let seq = 0
  let throttledOnce = false
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url, 'http://x')
    let body
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      body = undefined
    }
    const call = { method: req.method, path: url.pathname, search: url.search, hasKey: req.headers['x-api-key'] === apiKey, keyHeaderPresent: Boolean(req.headers['x-api-key']), body }
    calls.push(call)
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(json))
    }
    if (req.headers['x-api-key'] !== apiKey) return send(401, {})

    let m = /^\/analytics-query-api\/v1\/universes\/(\d+)\/metrics$/.exec(url.pathname)
    if (m && req.method === 'POST') {
      const b = body ?? {}
      const bad = !b.metric || b.granularity !== 'OneDay' || !RFC3339.test(b.startTime ?? '') || !RFC3339.test(b.endTime ?? '') || !(new Date(b.endTime) > new Date(b.startTime))
      if (bad) return send(400, { path: '', done: true, error: { code: 2001, message: 'A required field is missing or a field value is invalid.' } })
      // Throttle the very first query once, to prove Retry-After is honoured.
      if (!throttledOnce) {
        throttledOnce = true
        return send(429, { done: true, error: { code: 3000, message: 'The query exceeded the data point budget.' } }, { 'retry-after': '1' })
      }
      const days = Math.round((new Date(b.endTime) - new Date(b.startTime)) / 86_400_000)
      const points = Array.from({ length: days }, (_, i) => ({ time: new Date(new Date(b.startTime).getTime() + i * 86_400_000).toISOString().replace('.000Z', 'Z'), value: Number((0.05 + i * 0.001).toFixed(4)), status: 'Valid' }))
      const done = (path) => ({ path, done: true, metadata: { createdTime: new Date().toISOString() }, response: { values: [{ breakdowns: [], dataPoints: points }] } })
      if (b.metric === 'RFYDuration0To60') {
        // This one is "large": 202 first, finished on the second poll.
        const path = `v1/universes/${m[1]}/operations/metrics/op${++seq}`
        ops.set(path, { polls: 0, result: done(path) })
        return send(202, { path, done: false, metadata: { createdTime: new Date().toISOString() } })
      }
      return send(200, done(`v1/universes/${m[1]}/operations/metrics/op${++seq}`))
    }
    m = /^\/analytics-query-api\/(v1\/universes\/\d+\/operations\/metrics\/\w+)$/.exec(url.pathname)
    if (m && req.method === 'GET') {
      const op = ops.get(m[1])
      if (!op) return send(404, {})
      op.polls++
      if (op.polls < 2) return send(202, { path: m[1], done: false, metadata: { createdTime: new Date().toISOString() } })
      return send(200, op.result)
    }
    m = /^\/cloud\/v2\/universes\/(\d+)$/.exec(url.pathname)
    if (m && req.method === 'PATCH') {
      if (url.searchParams.get('updateMask') !== 'description') return send(400, { code: 'INVALID_ARGUMENT', message: 'updateMask must be description for this mock.' })
      if (typeof body?.description !== 'string') return send(400, { code: 'INVALID_ARGUMENT', message: 'description must be a string.' })
      if (body.description.length > 1000) return send(400, { code: 'INVALID_ARGUMENT', message: 'description too long' })
      if (m[1] === '404404') return send(404, { code: 'NOT_FOUND', message: 'Universe not found.' })
      const updateTime = new Date().toISOString()
      universes.set(m[1], { description: body.description, updateTime })
      return send(200, { path: `universes/${m[1]}`, updateTime, description: body.description })
    }
    send(404, { code: 'NOT_FOUND', message: 'No such mock endpoint.' })
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const addr = server.address()
  return {
    url: `http://127.0.0.1:${addr.port}`,
    calls,
    universes,
    close: () => new Promise((r) => server.close(r)),
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const m = await startMockOpenCloud({ apiKey: process.env.MOCK_KEY ?? 'mock-key', port: Number(process.env.PORT ?? 5203) })
  console.log(`mock Open Cloud on ${m.url}`)
}
