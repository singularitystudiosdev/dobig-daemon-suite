import type { DaemonSlug } from '@/data/daemons'
import type { ApiError, GalleryThumb, ResolveResponse, StatusResponse, ToolRequest, ToolRequestInput, VariantEvent, VariantRequest } from './apiTypes'
import type { CreateDaemonRequest, CreateDaemonResponse, CreditsResponse, DaemonDetail, DaemonRecord, DiscordServerInfo, RunEvent } from './runTypes'

/* Typed client for the dev-server API (server/**). Nothing here throws on an expected failure:
   resolveGame always returns ok true or an ApiError; streamVariants rejects only for transport failures. */

export async function getStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const res = await fetch('/api/status', { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Status request failed (${res.status})`)
  return (await res.json()) as StatusResponse
}

export async function resolveGame(link: string, signal?: AbortSignal): Promise<ResolveResponse | ApiError> {
  try {
    const res = await fetch(`/api/game?link=${encodeURIComponent(link)}`, { signal, headers: { accept: 'application/json' } })
    const body = (await res.json().catch(() => null)) as ResolveResponse | ApiError | null
    if (body && typeof body === 'object' && 'ok' in body) {
      if (body.ok) return { ...body, gallery: dedupe(body.gallery) }
      return body
    }
    return { ok: false, code: 'upstream', message: 'The demo server sent an unreadable answer. Try again in a moment.' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { ok: false, code: 'upstream', message: 'Could not reach the demo server. Check that it is running, then try again.' }
  }
}

function dedupe(gallery: GalleryThumb[]): GalleryThumb[] {
  const seen = new Set<string>()
  return gallery.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
}

/** POSTs a variants request and calls `onEvent` for each NDJSON line as it arrives.
    Resolves when the stream closes; an abort resolves quietly; other failures reject.
    The server holds the image key and charges credits, so nothing key-like is sent from here. The older four-argument
    form `(request, key, onEvent, signal)` still works: the key is ignored. */
export function streamVariants(request: VariantRequest, onEvent: (e: VariantEvent) => void, signal: AbortSignal): Promise<void>
export function streamVariants(request: VariantRequest, ignoredKey: string, onEvent: (e: VariantEvent) => void, signal: AbortSignal): Promise<void>
export async function streamVariants(request: VariantRequest, a: string | ((e: VariantEvent) => void), b: ((e: VariantEvent) => void) | AbortSignal, c?: AbortSignal): Promise<void> {
  const onEvent = typeof a === 'function' ? a : (b as (e: VariantEvent) => void)
  const signal = typeof a === 'function' ? (b as AbortSignal) : (c as AbortSignal)
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/x-ndjson' }
  try {
    const res = await fetch('/api/variants', { method: 'POST', headers, body: JSON.stringify(request), signal })
    if (!res.ok || !res.body) throw new Error(`The variants request failed (${res.status})`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const flush = (line: string) => {
      const text = line.trim()
      if (!text) return
      try {
        onEvent(JSON.parse(text) as VariantEvent)
      } catch {
        /* a partial or garbled line is skipped; the next event carries the state */
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        flush(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    flush(buffer)
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
    throw err
  }
}

/* ---- runs, daemons, credits, secrets (server/runs.ts, daemons.ts, credits.ts) ---- */

export class ApiFailure extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } })
  } catch {
    throw new ApiFailure(0, 'offline', 'Could not reach the local server. Check that it is running, then try again.')
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; code?: string; message?: string }) | null
  if (!res.ok) throw new ApiFailure(res.status, body?.code ?? 'upstream', body?.message ?? `The server answered ${res.status}.`)
  return body as T
}

export const getCredits = () => call<CreditsResponse>('/api/credits')
export const topUpCredits = (tool: DaemonSlug) => call<CreditsResponse>('/api/credits/topup', { method: 'POST', body: JSON.stringify({ tool }) })

export type SecretName = 'discord-bot-token' | 'openrouter-key' | 'gemini-key' | 'roblox-open-cloud-key'
/** Which secrets the server holds (never their values). */
export const getSecrets = () => call<{ secrets: Record<SecretName, boolean> }>('/api/secrets')
export const setSecret = (name: SecretName, value: string) => call<{ ok: true }>('/api/secrets', { method: 'POST', body: JSON.stringify({ name, value }) })
export const removeSecret = (name: SecretName) => call<{ ok: true }>(`/api/secrets/${name}`, { method: 'DELETE' })

export const listToolRequests = () => call<{ requests: ToolRequest[] }>('/api/requests').then((r) => r.requests)
export const sendToolRequest = (input: ToolRequestInput) => call<{ ok: true; request: ToolRequest }>('/api/requests', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.request)
export const listDaemons = (tool?: DaemonSlug) => call<{ daemons: DaemonRecord[] }>(`/api/daemons${tool ? `?tool=${tool}` : ''}`).then((r) => r.daemons)
export const getDaemon = (id: string) => call<DaemonDetail>(`/api/daemons/${encodeURIComponent(id)}`)
export const createDaemon = (req: CreateDaemonRequest) => call<CreateDaemonResponse>('/api/daemons', { method: 'POST', body: JSON.stringify(req) })
export const patchDaemon = (id: string, patch: { enabled?: boolean; intervalHours?: number }) =>
  call<DaemonRecord>(`/api/daemons/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const runDaemonNow = (id: string) => call<{ runId: string }>(`/api/daemons/${encodeURIComponent(id)}/run`, { method: 'POST' })
export const deleteDaemon = (id: string) => call<{ ok: true }>(`/api/daemons/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Resolve a public Discord invite (discord.gg/<code> or the code) with no token. */
export async function resolveDiscord(link: string, signal?: AbortSignal): Promise<{ ok: true; server: DiscordServerInfo } | ApiError> {
  try {
    const res = await fetch(`/api/discord/resolve?link=${encodeURIComponent(link)}`, { signal, headers: { accept: 'application/json' } })
    const body = (await res.json().catch(() => null)) as { ok: true; server: DiscordServerInfo } | ApiError | null
    if (body && typeof body === 'object' && 'ok' in body) return body
    return { ok: false, code: 'upstream', message: 'The local server sent an unreadable answer. Try again in a moment.' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return { ok: false, code: 'upstream', message: 'Could not reach the local server. Check that it is running, then try again.' }
  }
}

/** Follow a run: replays what it has already emitted, then streams live until it ends. Aborting resolves quietly. */
export async function streamRun(runId: string, onEvent: (e: RunEvent) => void, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { signal, headers: { accept: 'application/x-ndjson' } })
    if (!res.ok || !res.body) throw new ApiFailure(res.status, 'upstream', `The run stream failed (${res.status}).`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const flush = (line: string) => {
      const text = line.trim()
      if (!text) return
      try {
        onEvent(JSON.parse(text) as RunEvent)
      } catch {
        /* a garbled line is skipped; later events carry the state */
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        flush(buffer.slice(0, nl))
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    flush(buffer)
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
    throw err
  }
}
