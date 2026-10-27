import { CREDITS_PER_VARIANT, runCost, tools } from '../src/data/tools.ts'
import type { DaemonSlug } from '../src/data/daemons.ts'
import type { CreditsResponse } from '../src/lib/runTypes.ts'
import type { Store } from './store.ts'

/* Per-tool credit balances, kept server-side in credits.json. A balance never goes negative and every change is
   a single synchronous step, so concurrent runs and tile streams cannot both spend the same credits. */

export interface Credits {
  balance(tool: DaemonSlug): number
  charge(tool: DaemonSlug, n: number): boolean
  refund(tool: DaemonSlug, n: number): void
  topUp(tool: DaemonSlug): number
  /** What one run of the tool costs in credits (the thumbnail watcher is free; its images are charged per variant). */
  runCost(tool: DaemonSlug): number
  response(): CreditsResponse
}

const FILE = 'credits.json'

const isWhole = (n: number) => Number.isFinite(n) && Number.isInteger(n) && n >= 0

export function costOf(tool: DaemonSlug): number {
  return tool === 'thumbnail-daemon' ? 0 : runCost(tool)
}

export function createCredits(store: Store): Credits {
  const saved = store.load<Record<string, unknown>>(FILE, {}, (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
  const balances = {} as Record<DaemonSlug, number>
  for (const t of tools) {
    const v = saved[t.slug]
    balances[t.slug] = typeof v === 'number' && isWhole(v) ? v : t.startCredits
  }
  const persist = () => void store.save(FILE, balances)
  persist()

  const costs = () => Object.fromEntries(tools.map((t) => [t.slug, t.slug === 'thumbnail-daemon' ? CREDITS_PER_VARIANT : runCost(t.slug)])) as Record<DaemonSlug, number>
  const topUps = () => Object.fromEntries(tools.map((t) => [t.slug, t.topUp])) as Record<DaemonSlug, number>

  return {
    balance: (tool) => balances[tool] ?? 0,
    charge(tool, n) {
      if (!isWhole(n) || !(tool in balances)) return false
      if (balances[tool] < n) return false
      if (n > 0) {
        balances[tool] -= n
        persist()
      }
      return true
    },
    refund(tool, n) {
      if (!isWhole(n) || n === 0 || !(tool in balances)) return
      balances[tool] += n
      persist()
    },
    topUp(tool) {
      const add = tools.find((t) => t.slug === tool)?.topUp ?? 0
      balances[tool] += add
      persist()
      return balances[tool]
    },
    runCost: costOf,
    response: () => ({ balances: { ...balances }, costs: costs(), topUps: topUps() }),
  }
}
