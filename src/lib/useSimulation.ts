import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clamp } from './format'

/* The run engine every daemon page drives its demo with.
   A run is a list of stages with durations; `t` is scripted time in ms (speed-scaled).
   Visuals are pure functions of `t`, so pause, seek, replay and skip are all deterministic.
   State commits at most every FRAME_MS to keep re-renders cheap; CSS transitions smooth the rest. */

export interface SimStage {
  id: string
  label: string
  /** One short line under the label in the stage rail. */
  detail?: string
  /** Duration at 1x, in ms. */
  duration: number
}

export type SimStatus = 'idle' | 'running' | 'paused' | 'done'
export type StageState = 'pending' | 'active' | 'done'

export interface SimOptions {
  /** Start on mount after autoStartDelay. Default true. */
  autoStart?: boolean
  autoStartDelay?: number
  loop?: boolean
  loopDelay?: number
  initialSpeed?: number
}

export interface Simulation {
  stages: SimStage[]
  status: SimStatus
  /** Scripted ms elapsed, 0..total. */
  t: number
  total: number
  /** 0..1 over the whole run. */
  progress: number
  /** -1 before start, stages.length when done. */
  stageIndex: number
  stage: SimStage | null
  /** 0..1 within the current stage. */
  stageProgress: number
  speed: number
  setSpeed: (speed: number) => void
  /** Restart from 0 and run. */
  start: () => void
  pause: () => void
  resume: () => void
  /** Play, pause or replay depending on status. */
  toggle: () => void
  reset: () => void
  /** Jump to the end state. */
  skip: () => void
  seek: (ms: number) => void
  stageState: (idOrIndex: string | number) => StageState
  /** Offset of a stage's start in ms. */
  stageStart: (id: string) => number
  stageEnd: (id: string) => number
  /** ms since a stage started (negative before it). */
  since: (id: string) => number
  /** 0..1 progress through a stage (0 before, 1 after). */
  within: (id: string) => number
  /** True once a stage has begun in the current run. */
  reached: (id: string) => boolean
  /** True once t >= ms in the current run. */
  at: (ms: number) => boolean
  /** 0..1 progress between two absolute script times. */
  span: (from: number, to: number) => number
}

const FRAME_MS = 33

export function useSimulation(stages: SimStage[], options: SimOptions = {}): Simulation {
  const { autoStart = true, autoStartDelay = 700, loop = false, loopDelay = 5000, initialSpeed = 1 } = options

  const { offsets, total, byId } = useMemo(() => {
    let acc = 0
    const offs: number[] = []
    const map = new Map<string, { start: number; end: number; index: number }>()
    stages.forEach((s, i) => {
      offs.push(acc)
      map.set(s.id, { start: acc, end: acc + s.duration, index: i })
      acc += s.duration
    })
    return { offsets: offs, total: acc, byId: map }
  }, [stages])

  const [t, setT] = useState(0)
  const [status, setStatus] = useState<SimStatus>('idle')
  const [speed, setSpeed] = useState(initialSpeed)
  const tRef = useRef(0)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    if (status !== 'running') return
    let raf = 0
    let last = performance.now()
    let lastCommit = 0
    const tick = (now: number) => {
      // Cap the step so a backgrounded tab resumes where it left off instead of jumping.
      const dt = Math.min(now - last, 100)
      last = now
      tRef.current = Math.min(total, tRef.current + dt * speedRef.current)
      const finished = tRef.current >= total
      if (finished || now - lastCommit >= FRAME_MS) {
        lastCommit = now
        setT(tRef.current)
      }
      if (finished) {
        setStatus('done')
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status, total])

  useEffect(() => {
    if (!autoStart) return
    const id = window.setTimeout(() => {
      if (statusRef.current === 'idle') setStatus('running')
    }, autoStartDelay)
    return () => window.clearTimeout(id)
  }, [autoStart, autoStartDelay])

  useEffect(() => {
    if (!loop || status !== 'done') return
    const id = window.setTimeout(() => {
      tRef.current = 0
      setT(0)
      setStatus('running')
    }, loopDelay)
    return () => window.clearTimeout(id)
  }, [loop, loopDelay, status])

  const start = useCallback(() => {
    tRef.current = 0
    setT(0)
    setStatus('running')
  }, [])
  const pause = useCallback(() => setStatus((s) => (s === 'running' ? 'paused' : s)), [])
  const resume = useCallback(() => setStatus((s) => (s === 'paused' ? 'running' : s)), [])
  const reset = useCallback(() => {
    tRef.current = 0
    setT(0)
    setStatus('idle')
  }, [])
  const skip = useCallback(() => {
    tRef.current = total
    setT(total)
    setStatus('done')
  }, [total])
  const seek = useCallback(
    (ms: number) => {
      const next = clamp(ms, 0, total)
      tRef.current = next
      setT(next)
      setStatus((s) => (next >= total ? 'done' : s === 'running' ? 'running' : 'paused'))
    },
    [total],
  )
  const toggle = useCallback(() => {
    const s = statusRef.current
    if (s === 'running') pause()
    else if (s === 'paused') resume()
    else start()
  }, [pause, resume, start])

  const started = status !== 'idle'
  let stageIndex = -1
  if (started) {
    if (t >= total) stageIndex = stages.length
    else for (let i = 0; i < offsets.length; i++) if (offsets[i] <= t) stageIndex = i
  }
  const stage = stageIndex >= 0 && stageIndex < stages.length ? stages[stageIndex] : null
  const stageProgress = stage ? clamp((t - offsets[stageIndex]) / stage.duration) : stageIndex >= stages.length ? 1 : 0

  const stageState = (idOrIndex: string | number): StageState => {
    const i = typeof idOrIndex === 'number' ? idOrIndex : (byId.get(idOrIndex)?.index ?? -1)
    if (i < 0 || !started) return 'pending'
    if (i < stageIndex) return 'done'
    if (i === stageIndex) return 'active'
    return 'pending'
  }
  const stageStart = (id: string) => byId.get(id)?.start ?? 0
  const stageEnd = (id: string) => byId.get(id)?.end ?? 0
  const since = (id: string) => (started ? t - stageStart(id) : -Infinity)
  const within = (id: string) => {
    const s = byId.get(id)
    if (!s || !started) return 0
    return clamp((t - s.start) / (s.end - s.start))
  }
  const reached = (id: string) => started && t >= stageStart(id)
  const at = (ms: number) => started && t >= ms
  const span = (from: number, to: number) => (started ? clamp((t - from) / Math.max(1, to - from)) : 0)

  return {
    stages,
    status,
    t,
    total,
    progress: total ? t / total : 0,
    stageIndex,
    stage,
    stageProgress,
    speed,
    setSpeed,
    start,
    pause,
    resume,
    toggle,
    reset,
    skip,
    seek,
    stageState,
    stageStart,
    stageEnd,
    since,
    within,
    reached,
    at,
    span,
  }
}

/** Items whose `at` (absolute script ms) has passed. */
export function revealed<T extends { at: number }>(items: readonly T[], sim: Pick<Simulation, 't' | 'status'>): T[] {
  if (sim.status === 'idle') return []
  return items.filter((item) => item.at <= sim.t)
}
