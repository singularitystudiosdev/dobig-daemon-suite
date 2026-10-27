import { useEffect, useRef, useState, type RefObject } from 'react'
import { createRng } from './random'

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export function useInterval(callback: () => void, ms: number | null) {
  const saved = useRef(callback)
  saved.current = callback
  useEffect(() => {
    if (ms === null) return
    const id = window.setInterval(() => saved.current(), ms)
    return () => window.clearInterval(id)
  }, [ms])
}

/** A live counter that random-walks around `base`, like dobig.com's "Playing" numbers. */
export function useLiveNumber(base: number, { spread = 0.003, every = 1800, seed = 'live' }: { spread?: number; every?: number; seed?: string } = {}) {
  const [value, setValue] = useState(base)
  const rng = useRef(createRng(seed + base))
  useEffect(() => setValue(base), [base])
  useInterval(() => {
    setValue((v) => {
      const drift = (base - v) * 0.2
      const step = rng.current.normal(0, base * spread)
      return Math.max(0, Math.round(v + drift + step))
    })
  }, every)
  return value
}

export function useOnClickOutside(ref: RefObject<HTMLElement | null>, handler: () => void, active = true) {
  const saved = useRef(handler)
  saved.current = handler
  useEffect(() => {
    if (!active) return
    const on = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) saved.current()
    }
    document.addEventListener('pointerdown', on)
    return () => document.removeEventListener('pointerdown', on)
  }, [ref, active])
}
