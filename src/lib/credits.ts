import { useCallback, useSyncExternalStore } from 'react'
import { toolsBySlug } from '@/data/tools'
import type { DaemonSlug } from '@/data/daemons'

/* Credits are per tool, persisted in localStorage under dobig.credits.<slug> and shared across tabs
   through the storage event. A tab with blocked storage falls back to memory. */

const listeners = new Set<() => void>()
const memory = new Map<string, number>()

const keyFor = (slug: DaemonSlug) => `dobig.credits.${slug}`

export function readCredits(slug: DaemonSlug): number {
  const start = toolsBySlug[slug].startCredits
  try {
    const raw = window.localStorage.getItem(keyFor(slug))
    if (raw !== null) {
      const n = Number(raw)
      if (Number.isFinite(n) && n >= 0) return Math.floor(n)
    }
  } catch {
    /* fall through to memory */
  }
  return memory.get(slug) ?? start
}

function write(slug: DaemonSlug, value: number) {
  const next = Math.max(0, Math.floor(value))
  memory.set(slug, next)
  try {
    window.localStorage.setItem(keyFor(slug), String(next))
  } catch {
    /* memory copy is enough */
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith('dobig.credits.')) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export interface Credits {
  balance: number
  /** Takes `n` credits. Returns false, and changes nothing, when the balance is short. */
  spend: (n: number) => boolean
  refund: (n: number) => void
  /** Mock top-up: adds the tool's ToolMeta.topUp. Returns the amount added. */
  topUp: () => number
}

export function useCredits(slug: DaemonSlug): Credits {
  const balance = useSyncExternalStore(subscribe, () => readCredits(slug), () => toolsBySlug[slug].startCredits)
  const spend = useCallback(
    (n: number) => {
      if (n <= 0) return true
      const have = readCredits(slug)
      if (have < n) return false
      write(slug, have - n)
      return true
    },
    [slug],
  )
  const refund = useCallback(
    (n: number) => {
      if (n > 0) write(slug, readCredits(slug) + n)
    },
    [slug],
  )
  const topUp = useCallback(() => {
    const add = toolsBySlug[slug].topUp
    write(slug, readCredits(slug) + add)
    return add
  }, [slug])
  return { balance, spend, refund, topUp }
}

/** A tool's balance, for lists that show every tool (the tool switcher). */
export function useBalance(slug: DaemonSlug): number {
  return useSyncExternalStore(subscribe, () => readCredits(slug), () => toolsBySlug[slug].startCredits)
}
