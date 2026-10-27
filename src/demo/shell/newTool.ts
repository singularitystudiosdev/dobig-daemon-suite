import { useSyncExternalStore } from 'react'
import type { DaemonSlug } from '@/data/daemons'

/* One place to open the "contact us" panel from anywhere: the tool menu's New tool row, the Automate button on every
   tool, a finding's "send it for me". The panel itself (NewToolDialog) is mounted once, in the tool switcher. */

export interface NewToolPreset {
  /** new-tool: ask for something that does not exist yet. automation: set an existing tool up to run for you. */
  kind: 'new-tool' | 'automation'
  tool?: DaemonSlug
  /** The game name or link the request is about. */
  game?: string
  /** The request text to start from. */
  message?: string
}

interface State {
  open: boolean
  preset: NewToolPreset
}

let state: State = { open: false, preset: { kind: 'new-tool' } }
const listeners = new Set<() => void>()
const emit = (next: State) => {
  state = next
  listeners.forEach((l) => l())
}

export const openNewTool = (preset?: NewToolPreset) => emit({ open: true, preset: preset ?? { kind: 'new-tool' } })
export const closeNewTool = () => emit({ ...state, open: false })

export function useNewToolState(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}
