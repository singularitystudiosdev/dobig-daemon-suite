import { useSyncExternalStore } from 'react'

/* The visitor's Gemini API key lives in this browser only (localStorage). It is sent as the x-gemini-key
   header to this app's own dev server and nowhere else. */

const KEY = 'dobig.gemini.key'
const listeners = new Set<() => void>()
let memory = ''

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? memory
  } catch {
    return memory
  }
}

function emit() {
  listeners.forEach((l) => l())
}

export function readGeminiKey(): string {
  return read()
}

export function writeGeminiKey(key: string) {
  const clean = key.trim()
  memory = clean
  try {
    if (clean) window.localStorage.setItem(KEY, clean)
    else window.localStorage.removeItem(KEY)
  } catch {
    /* storage blocked: the in-memory copy still serves this tab */
  }
  emit()
}

export function removeGeminiKey() {
  writeGeminiKey('')
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** The saved key, or an empty string. Re-renders on save, remove and changes from other tabs. */
export function useGeminiKey(): string {
  return useSyncExternalStore(subscribe, read, () => '')
}

/** "AIza...x7Qk": enough to recognise a key without showing it. */
export function maskKey(key: string): string {
  if (key.length <= 10) return '****'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}
