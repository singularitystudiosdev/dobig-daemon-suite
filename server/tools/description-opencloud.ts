/* Roblox Open Cloud paths used by the Description Daemon, both gated on the owner's key (secret 'roblox-open-cloud-key').
   Verified against the official docs on 2026-10-27:
   - Analytics Query API: POST {base}/analytics-query-api/v1/universes/{universeId}/metrics with header x-api-key and body
     { metric, granularity, startTime, endTime }. Most queries answer 200 with done:true; large ones answer 202 with
     done:false and a `path`; poll GET {base}/analytics-query-api/{path} with the same key until done. Errors arrive as
     done:true + error {code,message}; 429 code 3000 = data point budget, 503 code 2002 = transient. The key needs
     the universe.analytics:read operation on the universe-analytics system.
     https://create.roblox.com/docs/cloud/guides/analytics  and  .../guides/analytics/metrics
   - Update Universe: PATCH {base}/cloud/v2/universes/{universeId}?updateMask=description with x-api-key and body
     { description }, scope universe:write, 100 requests a minute per key owner.
     https://create.roblox.com/docs/cloud/reference/features/universes
   These two paths were NOT run against real Roblox (no key on the build machine): they are verified against the mock
   in server/test/mock-opencloud.mjs only. `base` defaults to https://apis.roblox.com; ROBLOX_OPEN_CLOUD_BASE overrides it
   (the tests point it at the mock). */

export const OPEN_CLOUD_BASE = 'https://apis.roblox.com'

export function openCloudBase(): string {
  return (process.env.ROBLOX_OPEN_CLOUD_BASE?.trim() || OPEN_CLOUD_BASE).replace(/\/+$/, '')
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })

/** Removes the key (and anything shaped like one) from text that may be shown to the user. */
export function scrubKey(text: string, key: string): string {
  let out = text
  if (key) out = out.split(key).join('<key>')
  return out
}

/** The metrics read for the measured baseline. Names and meanings are from the supported-metrics page. */
export const BASELINE_METRICS: { metric: string; label: string; note: string }[] = [
  { metric: 'RFYPlayThroughRate', label: 'Home play-through rate', note: 'users who played after seeing the game in Recommended for You (the most important home signal)' },
  { metric: 'RFYDuration0To60', label: 'First-play bounce rate, 0 to 60 s', note: 'users who left within a minute of a first play from Recommended for You (a negative signal)' },
  { metric: 'ImpressionCVR', label: 'Impression click-through, all sources', note: 'users who clicked after an impression, across every source (Roblox calls it Users impression CTR)' },
]

export interface BaselineMetric {
  metric: string
  label: string
  note: string
  /** Mean of the daily values in the window, as Roblox returned them (the docs do not say whether rates are fractions or percents). */
  mean: number | null
  /** Mean of the first and last seven days, to show the direction. */
  firstWeek: number | null
  lastWeek: number | null
  days: number
  /** Why there is no value, when mean is null. */
  unavailable?: string
}

export interface Baseline {
  from: string
  to: string
  metrics: BaselineMetric[]
}

interface Point {
  time: string
  value: number
  status?: string
}

interface OpResponse {
  path?: string
  done?: boolean
  response?: { values?: { dataPoints?: Point[] }[] }
  error?: { code?: number; message?: string }
}

class OpenCloudError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function oc(key: string, method: 'GET' | 'POST' | 'PATCH', url: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; json: OpResponse; retryAfter: number }> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: { 'x-api-key': key, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
  } catch {
    throw new OpenCloudError(0, 'Roblox Open Cloud did not answer.')
  }
  const text = await res.text()
  let json: OpResponse = {}
  try {
    json = text ? (JSON.parse(text) as OpResponse) : {}
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, retryAfter: Math.min(30, Number(res.headers.get('retry-after')) || 0) }
}

/** One metric over [start, end): submit, then poll while the API answers 202. Honours Retry-After and backs off on 429/503. */
export async function queryMetric(key: string, universeId: number, metric: string, start: Date, end: Date, signal?: AbortSignal): Promise<Point[]> {
  const base = openCloudBase()
  const submit = `${base}/analytics-query-api/v1/universes/${universeId}/metrics`
  const payload = { metric, granularity: 'OneDay', startTime: start.toISOString(), endTime: end.toISOString() }
  let attempt = 0
  let next: { method: 'GET' | 'POST'; url: string; body?: unknown } = { method: 'POST', url: submit, body: payload }
  for (let polls = 0; polls < 14; polls++) {
    if (signal?.aborted) throw new OpenCloudError(0, 'Cancelled.')
    const r = await oc(key, next.method, next.url, next.body, signal)
    if (r.status === 429 || r.status === 503) {
      attempt++
      if (attempt > 3) throw new OpenCloudError(r.status, r.status === 429 ? `Roblox rate limited the query${r.json.error?.code === 3000 ? ' (data point budget)' : ''}.` : 'Roblox Open Cloud is temporarily unavailable.')
      await sleep((r.retryAfter || 2 ** attempt) * 1000, signal)
      continue
    }
    if (r.status === 401 || r.status === 403) throw new OpenCloudError(r.status, 'Roblox rejected the key. It needs the universe.analytics:read permission on this universe.')
    if (r.status === 404) throw new OpenCloudError(404, 'Roblox could not find that universe or query.')
    if (r.json.error) throw new OpenCloudError(r.status, `Roblox answered: ${r.json.error.message ?? `error ${r.json.error.code}`}`.slice(0, 200))
    if (r.status >= 400) throw new OpenCloudError(r.status, `Roblox answered ${r.status}.`)
    if (r.json.done === true) return r.json.response?.values?.[0]?.dataPoints ?? []
    if (!r.json.path) throw new OpenCloudError(r.status, 'Roblox returned an unfinished query with no path to poll.')
    // 202: poll the operation path.
    next = { method: 'GET', url: `${base}/analytics-query-api/${r.json.path.replace(/^\/+/, '')}` }
    await sleep(Math.min(5000, 800 * (polls + 1)), signal)
  }
  throw new OpenCloudError(504, 'The query did not finish in time.')
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** The last 14 full UTC days of the baseline metrics. Never throws: a metric that cannot be read says why. */
export async function fetchBaseline(key: string, universeId: number, now: Date, signal?: AbortSignal): Promise<Baseline> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end.getTime() - 14 * 86_400_000)
  const metrics: BaselineMetric[] = []
  for (const m of BASELINE_METRICS) {
    try {
      const pts = (await queryMetric(key, universeId, m.metric, start, end, signal)).filter((p) => typeof p.value === 'number' && p.status !== 'NotStatisticallySignificant')
      pts.sort((a, b) => a.time.localeCompare(b.time))
      const vals = pts.map((p) => p.value)
      metrics.push({ ...m, mean: mean(vals), firstWeek: mean(vals.slice(0, 7)), lastWeek: vals.length > 7 ? mean(vals.slice(-7)) : null, days: vals.length, ...(vals.length ? {} : { unavailable: 'Roblox returned no data points for this window.' }) })
    } catch (err) {
      metrics.push({ ...m, mean: null, firstWeek: null, lastWeek: null, days: 0, unavailable: scrubKey(err instanceof Error ? err.message : 'The query failed.', key) })
      if (err instanceof OpenCloudError && (err.status === 401 || err.status === 403 || err.status === 404)) break
    }
    await sleep(400, signal)
  }
  return { from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10), metrics }
}

export function formatMetric(v: number): string {
  const abs = Math.abs(v)
  return abs >= 100 ? v.toFixed(1) : abs >= 1 ? v.toFixed(3) : v.toPrecision(3)
}

export interface PatchResult {
  ok: boolean
  /** What Roblox answered. */
  robloxStatus: number
  message: string
  updateTime?: string
  description?: string
}

/** PATCH the universe description. The key is only ever sent in the x-api-key header and scrubbed from anything returned. */
export async function patchDescription(key: string, universeId: number, text: string, signal?: AbortSignal): Promise<PatchResult> {
  const url = `${openCloudBase()}/cloud/v2/universes/${universeId}?updateMask=description`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ description: text }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
  } catch {
    return { ok: false, robloxStatus: 0, message: 'Roblox Open Cloud did not answer. Nothing was changed.' }
  }
  const raw = scrubKey(await res.text(), key)
  let json: { updateTime?: string; description?: string; message?: string; code?: string } = {}
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    /* non-JSON */
  }
  if (res.ok) return { ok: true, robloxStatus: res.status, message: 'Roblox accepted the new description.', updateTime: json.updateTime, description: json.description }
  const hint = res.status === 401 || res.status === 403 ? 'Roblox rejected the key. It needs the universe:write permission on this universe.' : res.status === 404 ? 'Roblox could not find that universe.' : res.status === 429 ? 'Roblox rate limited the update. Try again in a minute.' : `Roblox answered ${res.status}.`
  return { ok: false, robloxStatus: res.status, message: `${hint}${json.message ? ` ${json.message}` : ''}`.slice(0, 300) }
}
