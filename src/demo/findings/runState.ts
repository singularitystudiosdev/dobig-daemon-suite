import { useCallback, useEffect, useReducer, useState } from 'react'
import { streamRun } from '@/lib/api'
import type { EntryStatus } from '../types'
import type { RunAction, RunErrorCode, RunEvent, RunSummary, StepState } from '@/lib/runTypes'
import type { Finding } from '@/lib/runTypes'
import type { Tone } from '@/lib/tone'

/* Follows one server run and folds its NDJSON events into state. The server replays everything a run has emitted and then
   tails it live, so every `start` event begins a fresh fold: a reconnect replays into the same state without duplicates. */

export interface RunStep {
  id: string
  label: string
  state: StepState
  detail?: string
  at: number
}

export interface RunFailure {
  code: RunErrorCode | 'connection'
  message: string
  action?: RunAction
}

export interface RunEnd {
  status: 'done' | 'failed'
  findings: number
  newFindings: number
  durationMs: number
  refunded: number
}

export interface RunState {
  runId: string | null
  /** The start event has arrived. */
  started: boolean
  startedAt: number | null
  cost: number
  steps: RunStep[]
  summary: RunSummary | null
  /** Arrival order: the server sends findings already in display order. */
  findings: Finding[]
  end: RunEnd | null
  error: RunFailure | null
}

export const EMPTY_RUN: RunState = {
  runId: null,
  started: false,
  startedAt: null,
  cost: 0,
  steps: [],
  summary: null,
  findings: [],
  end: null,
  error: null,
}

export type RunReduce =
  | { type: 'reset'; runId: string | null }
  | { type: 'event'; event: RunEvent; now: number }
  | { type: 'lost'; message: string }

export function runReducer(state: RunState, action: RunReduce): RunState {
  switch (action.type) {
    case 'reset':
      return { ...EMPTY_RUN, runId: action.runId }
    case 'lost':
      return state.end || state.error ? state : { ...state, error: { code: 'connection', message: action.message } }
    case 'event': {
      const e = action.event
      switch (e.type) {
        case 'start': {
          const startedAt = Date.parse(e.startedAt)
          return { ...EMPTY_RUN, runId: state.runId, started: true, startedAt: Number.isFinite(startedAt) ? startedAt : action.now, cost: e.cost }
        }
        case 'step': {
          const i = state.steps.findIndex((s) => s.id === e.id)
          const next: RunStep = { id: e.id, label: e.label, state: e.state, detail: e.detail, at: e.at }
          const steps = i === -1 ? [...state.steps, next] : state.steps.map((s, k) => (k === i ? { ...s, ...next, detail: e.detail ?? s.detail } : s))
          return { ...state, steps }
        }
        case 'summary':
          return { ...state, summary: e.summary }
        case 'finding': {
          // A finding id arriving twice replaces the first (the same thing, re-sent), keeping its place.
          const i = state.findings.findIndex((f) => f.id === e.finding.id)
          const findings = i === -1 ? [...state.findings, e.finding] : state.findings.map((f, k) => (k === i ? e.finding : f))
          return { ...state, findings }
        }
        case 'end': {
          return {
            ...state,
            end: { status: e.status, findings: e.findings, newFindings: e.newFindings, durationMs: e.durationMs, refunded: e.refunded },
            // Steps still marked active when the run is over did not finish: close them instead of spinning forever.
            steps: state.steps.map((s) => (s.state === 'active' ? { ...s, state: e.status === 'done' ? 'done' : 'failed' } : s)),
          }
        }
        case 'error':
          return { ...state, error: { code: e.code, message: e.message, action: e.action } }
      }
    }
  }
}

export const isEnded = (s: RunState) => s.end !== null || s.error !== null
export const isRunning = (s: RunState) => s.runId !== null && !isEnded(s)

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      window.clearTimeout(t)
      resolve()
    })
  })

const BACKOFF_MS = [400, 800, 1600, 3000, 5000]
const MAX_RECONNECTS = 12

/** Follows `runId`: aborts the previous stream, resets, streams, and reopens (with a short backoff) while the run is still active. */
export function useRun(runId: string | null): { state: RunState; reconnect: () => void } {
  const [state, dispatch] = useReducer(runReducer, EMPTY_RUN)
  const [nonce, setNonce] = useState(0)
  const reconnect = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    dispatch({ type: 'reset', runId })
    if (!runId) return
    const ac = new AbortController()
    let terminal = false
    const onEvent = (event: RunEvent) => {
      if (ac.signal.aborted) return
      if (event.type === 'end' || event.type === 'error') terminal = true
      dispatch({ type: 'event', event, now: Date.now() })
    }
    void (async () => {
      let attempts = 0
      let reason = ''
      while (!ac.signal.aborted && !terminal) {
        try {
          await streamRun(runId, onEvent, ac.signal)
          reason = 'The run stream closed before the run finished.'
        } catch (err) {
          reason = err instanceof Error ? err.message : 'The run stream broke.'
        }
        if (ac.signal.aborted || terminal) return
        if (attempts >= MAX_RECONNECTS) {
          dispatch({ type: 'lost', message: `${reason} The server may be restarting.` })
          return
        }
        await sleep(BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)], ac.signal)
        attempts += 1
      }
    })()
    return () => ac.abort()
  }, [runId, nonce])

  return { state, reconnect }
}

/** `now` that ticks while `on`, for elapsed clocks. */
export function useNow(on: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [on, everyMs])
  return now
}

/* ---- status for the right-hand list ---- */

const TONE_RANK: Record<Tone, number> = { danger: 6, warn: 5, data6: 4, data5: 3, accent: 2, live: 1, ink: 0, muted: 0 }

/** The most severe tone among the findings' badges. */
export function worstTone(findings: Finding[]): Tone {
  let worst: Tone = 'muted'
  for (const f of findings) if (TONE_RANK[f.badge.tone] > TONE_RANK[worst]) worst = f.badge.tone
  return worst
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

const ERROR_LABEL: Record<RunFailure['code'], string> = {
  'no-llm-key': 'Needs an analysis key',
  'no-image-key': 'Needs an image key',
  'no-discord-token': 'Needs a Discord token',
  'discord-bot-missing': 'Bot not in the server',
  'discord-intent': 'Needs Message Content intent',
  credits: 'Out of credits',
  'not-found': 'Not found',
  private: 'Private',
  'rate-limited': 'Rate limited',
  upstream: 'Source unavailable',
  'bad-input': 'Cannot read the target',
  aborted: 'Stopped',
  internal: 'Run failed',
  connection: 'Connection lost',
}

const NEEDS_ACTION = new Set<RunFailure['code']>(['no-llm-key', 'no-image-key', 'no-discord-token', 'discord-bot-missing', 'discord-intent', 'credits', 'rate-limited'])

export function statusFor(state: RunState): EntryStatus {
  if (!state.runId) return { label: 'Not run yet', tone: 'muted' }
  if (state.error) return { label: ERROR_LABEL[state.error.code], tone: NEEDS_ACTION.has(state.error.code) ? 'warn' : 'danger' }
  if (state.end) {
    if (state.end.status === 'failed') return { label: 'Run failed', tone: 'danger' }
    const n = state.findings.length
    const fresh = state.end.newFindings
    return { label: `${plural(n, 'finding', 'findings')}${fresh > 0 ? `, ${fresh.toLocaleString('en-US')} new` : ''}`, tone: n === 0 ? 'muted' : worstTone(state.findings) }
  }
  const active = [...state.steps].reverse().find((s) => s.state === 'active')
  return { label: active?.label ?? (state.started ? 'Starting' : 'Connecting'), tone: 'accent' }
}
