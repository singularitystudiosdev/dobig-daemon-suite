import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { DaemonSlug } from '@/data/daemons'
import { getCredits, topUpCredits } from './api'
import type { CreditsResponse } from './runTypes'

/* Credits live on the server (.data/credits.json), per tool. This module keeps one cached copy for the whole page:
   every component reads it through useCredits / useBalance, and anything that changes the balance (a run starts, a
   variant fails and is refunded, a top-up) calls refreshCredits() so every chip, switcher row and button agrees.
   Nothing about credits is stored in the browser. */

type Snapshot = { data: CreditsResponse | null; loading: boolean; failed: boolean }

let snapshot: Snapshot = { data: null, loading: false, failed: false }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Snapshot) {
  snapshot = next
  listeners.forEach((l) => l())
}

/** Re-reads every tool's balance from the server. Concurrent calls share one request. */
export function refreshCredits(): Promise<void> {
  if (inflight) return inflight
  set({ ...snapshot, loading: true })
  inflight = getCredits()
    .then((data) => set({ data, loading: false, failed: false }))
    .catch(() => set({ ...snapshot, loading: false, failed: true }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const read = () => snapshot

export interface Credits {
  /** What this tool has left. 0 while the first answer is loading: check `loading` before calling it empty. */
  balance: number
  /** What one run costs; for the thumbnail tool, ONE variant. */
  cost: number
  /** What "Add credits" adds. */
  topUpAmount: number
  /** Adds this tool's top-up on the server. Resolves with the amount added and the new balance, or null when the server refused. */
  topUp: () => Promise<{ added: number; balance: number } | null>
  refresh: () => Promise<void>
  loading: boolean
}

export function useCredits(slug: DaemonSlug): Credits {
  const snap = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (!snapshot.data && !inflight) void refreshCredits()
  }, [])
  const topUp = useCallback(async () => {
    try {
      const before = snapshot.data?.balances[slug] ?? 0
      const next = await topUpCredits(slug)
      set({ data: next, loading: false, failed: false })
      const added = next.balances[slug] - before
      return { added: added > 0 ? added : next.topUps[slug], balance: next.balances[slug] }
    } catch {
      return null
    }
  }, [slug])
  const data = snap.data
  return {
    balance: data?.balances[slug] ?? 0,
    cost: data?.costs[slug] ?? 0,
    topUpAmount: data?.topUps[slug] ?? 0,
    topUp,
    refresh: refreshCredits,
    loading: snap.loading && !data,
  }
}

/** A tool's balance for lists that show every tool (the tool switcher). Null until the server has answered. */
export function useBalance(slug: DaemonSlug): number | null {
  const snap = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (!snapshot.data && !inflight) void refreshCredits()
  }, [])
  return snap.data?.balances[slug] ?? null
}
