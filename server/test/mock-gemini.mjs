// Mock of the Gemini image endpoints (generateContent AND interactions) and OpenRouter's POST /api/v1/images for key-less tests.
// The behaviour is picked by the API key the caller sends in x-goog-api-key:
//   test-ok          generateContent -> JPEG                 test-interactions  generateContent 404, interactions -> JPEG
//   test-block       promptFeedback.blockReason SAFETY       test-finish        finishReason IMAGE_SAFETY, no image
//   test-429         first call per tile 429 (Retry-After 1) then JPEG       test-429-always  always 429
//   test-slow        waits 20 s before answering             test-badkey        400 API_KEY_INVALID
//   test-noimage     200 with text only                      test-modality      400 until TEXT+IMAGE modalities
// OpenRouter (POST /api/v1/images, key from `Authorization: Bearer`; a leading sk-or- is ignored when picking the behaviour):
//   test-or-ok       -> JPEG        test-or-401  401 Invalid API key     test-or-402  402 out of credits
//   test-or-429      first call per 4 answers 429 (Retry-After 1) then JPEG        test-or-moderation  400 blocked by safety policy
//   test-or-empty    200 with data:[]
// GET /__stats -> {calls, maxConcurrent, prompts[], keys[], routes[], aborted, openrouter:{calls, concurrent, maxConcurrent, prompts[], keys[], images[]}}   POST /__reset clears it.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// A real, decodable JPEG (96x96) next to this file.
const JPEG = fs.readFileSync(path.join(here, 'fixture.jpg'))
const port = Number(process.env.MOCK_PORT ?? 5199)

let stats
const reset = () => (stats = { calls: 0, concurrent: 0, maxConcurrent: 0, prompts: [], keys: [], routes: [], aborted: 0, images: [], openrouter: { calls: 0, concurrent: 0, maxConcurrent: 0, prompts: [], keys: [], images: [], count429: 0 } })
reset()

const wait = (ms, res) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    // Node >= 16 fires req 'close' once the body is read; the response socket is what shows a client abort.
    res.on('close', () => {
      clearTimeout(t)
      resolve()
    })
  })

function extract(route, body) {
  if (route === 'generate') {
    const parts = body.contents?.[0]?.parts ?? []
    return {
      prompt: parts.find((p) => p.text)?.text,
      image: parts.find((p) => p.inlineData)?.inlineData,
      cfg: body.generationConfig,
    }
  }
  const input = body.input ?? []
  const img = input.find((p) => p.type === 'image')
  return {
    prompt: input.find((p) => p.type === 'text')?.text,
    image: img && { mimeType: img.mime_type, data: img.data },
    cfg: { response_format: body.response_format, generation_config: body.generation_config, model: body.model },
  }
}

const send = (res, status, json, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(json))
}

async function openrouter(req, res) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const bearer = /^Bearer (.*)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
  const key = bearer.replace(/^sk-or-/, '')
  const st = stats.openrouter
  const ref = body.input_references?.[0]?.image_url?.url ?? ''
  const m = /^data:([^;]+);base64,(.*)$/s.exec(ref)
  st.calls++
  st.prompts.push(body.prompt)
  st.keys.push(bearer)
  st.images.push({ mime: m?.[1], bytes: m ? Buffer.from(m[2], 'base64').length : 0, refs: body.input_references?.length ?? 0, aspect_ratio: body.aspect_ratio, resolution: body.resolution, model: body.model })
  st.concurrent++
  st.maxConcurrent = Math.max(st.maxConcurrent, st.concurrent)
  res.on('close', () => st.concurrent--)
  await wait(300 + Math.random() * 400, res)
  if (res.destroyed) return
  if (key === 'test-or-401') return send(res, 401, { error: { message: 'Invalid API key', code: 401 } })
  if (key === 'test-or-402') return send(res, 402, { error: { message: 'Insufficient credits. Add more using https://openrouter.ai/credits', code: 402 } })
  if (key === 'test-or-moderation') return send(res, 400, { error: { message: 'Request blocked by safety policy', code: 400 } })
  if (key === 'test-or-empty') return send(res, 200, { created: Math.floor(Date.now() / 1000), data: [], usage: { cost: 0.03 } })
  if (key === 'test-or-429' && st.count429++ % 4 === 0) return send(res, 429, { error: { message: 'Rate limit exceeded', code: 429 } }, { 'retry-after': '1' })
  return send(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: JPEG.toString('base64'), media_type: 'image/jpeg' }], usage: { cost: 0.03 } })
}

http
  .createServer(async (req, res) => {
    if (req.url === '/__stats') return send(res, 200, stats)
    if (req.url === '/__reset') {
      reset()
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url === '/api/v1/images') return openrouter(req, res).catch((err) => !res.headersSent && send(res, 500, { error: { message: String(err) } }))
    const route = req.url.includes(':generateContent') ? 'generate' : req.url.endsWith('/v1beta/interactions') ? 'interactions' : null
    if (req.method !== 'POST' || !route) return send(res, 404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } })
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const key = req.headers['x-goog-api-key'] ?? ''
    const { prompt, image, cfg } = extract(route, body)
    stats.calls++
    stats.prompts.push(prompt)
    stats.keys.push(key)
    stats.routes.push(route)
    stats.images.push({ mime: image?.mimeType, bytes: image?.data ? Buffer.from(image.data, 'base64').length : 0, cfg })
    stats.concurrent++
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.concurrent)
    let aborted = true
    res.on('close', () => {
      stats.concurrent--
      if (aborted && !res.writableFinished) stats.aborted++
    })
    try {
      const delay = key === 'test-slow' ? 20_000 : 300 + Math.random() * 400
      await wait(delay, res)
      if (res.destroyed) return
      const ok = () => {
        aborted = false
        if (route === 'generate') {
          return send(res, 200, { candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/jpeg', data: JPEG.toString('base64') } }] }, finishReason: 'STOP' }] })
        }
        return send(res, 200, { status: 'completed', steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: JPEG.toString('base64') }] }] })
      }
      aborted = false
      if (key === 'test-badkey') return send(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })
      if (key === 'test-block') return send(res, 200, { promptFeedback: { blockReason: 'SAFETY' } })
      if (key === 'test-finish') return send(res, 200, { candidates: [{ finishReason: 'IMAGE_SAFETY' }] })
      if (key === 'test-noimage') return send(res, 200, { candidates: [{ content: { parts: [{ text: 'sorry' }] }, finishReason: 'NO_IMAGE' }] })
      if (key === 'test-429-always') return send(res, 429, { error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '1' })
      if (key === 'test-429') {
        // Every 4th call (1st, 5th, ...) answers 429 with Retry-After: 1; the client retries and gets a JPEG.
        if (stats.calls % 4 === 1) return send(res, 429, { error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } }, { 'retry-after': '1' })
        return ok()
      }
      if (key === 'test-interactions' && route === 'generate') return send(res, 404, { error: { code: 404, message: 'models/gemini-nano-banana-2.1 is not found for API version v1beta, or is not supported for generateContent.', status: 'NOT_FOUND' } })
      if (key === 'test-modality' && route === 'generate' && JSON.stringify(cfg?.responseModalities) === '["IMAGE"]') {
        return send(res, 400, { error: { code: 400, message: 'The requested combination of response modalities is not supported.', status: 'INVALID_ARGUMENT' } })
      }
      return ok()
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: { message: String(err) } })
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`mock gemini on http://127.0.0.1:${port}`))
