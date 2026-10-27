import { useEffect, useSyncExternalStore } from 'react'
import type { DaemonSlug } from '@/data/daemons'
import { getSecrets, getStatus, removeSecret, setSecret, type SecretName } from './api'
import type { ImageProvider, StatusResponse } from './apiTypes'

/* Keys live on the server, in .data/secrets.json (mode 0600). The browser never receives a key back: it learns only
   which ones exist (getSecrets) and what the server can do with them (getStatus). This module keeps one cached copy
   of that answer for the page, so the Keys button, the dialog and the workspaces agree.
   Older builds kept a Gemini key in localStorage; it is deleted on first load and never sent anywhere. */

const LEGACY_KEY = 'dobig.gemini.key'
try {
  window.localStorage.removeItem(LEGACY_KEY)
} catch {
  /* storage blocked: nothing was stored */
}

/** The server's status. `llm` describes the analysis side (OpenRouter) and is read defensively. */
export type ServerStatus = StatusResponse & { llm?: unknown }

type Snapshot = { secrets: Record<SecretName, boolean> | null; status: ServerStatus | null; loading: boolean; failed: boolean }

let snapshot: Snapshot = { secrets: null, status: null, loading: false, failed: false }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function set(next: Snapshot) {
  snapshot = next
  listeners.forEach((l) => l())
}

/** Re-reads which keys the server holds and its status. Concurrent calls share one request. */
export function refreshKeys(): Promise<void> {
  if (inflight) return inflight
  set({ ...snapshot, loading: true })
  inflight = Promise.allSettled([getSecrets(), getStatus()])
    .then(([s, st]) =>
      set({
        secrets: s.status === 'fulfilled' ? s.value.secrets : snapshot.secrets,
        status: st.status === 'fulfilled' ? (st.value as ServerStatus) : snapshot.status,
        loading: false,
        failed: s.status === 'rejected' && st.status === 'rejected',
      }),
    )
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

export interface Keys {
  /** null until the server has answered. */
  secrets: Record<SecretName, boolean> | null
  status: ServerStatus | null
  loading: boolean
  failed: boolean
  /** An OpenRouter key is saved: the analysis tools can run. */
  hasAnalysisKey: boolean
  /** Either image key is saved, or the server has one in its environment. */
  hasImageKey: boolean
  hasDiscordToken: boolean
  refresh: () => Promise<void>
}

export function useKeys(): Keys {
  const snap = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (!snapshot.secrets && !snapshot.status && !inflight) void refreshKeys()
  }, [])
  const secrets = snap.secrets
  return {
    secrets,
    status: snap.status,
    loading: snap.loading && !secrets,
    failed: snap.failed,
    hasAnalysisKey: Boolean(secrets?.['openrouter-key']) || Boolean(snap.status?.llm && snap.status.llm !== 'none'),
    hasImageKey: Boolean(secrets?.['openrouter-key'] || secrets?.['gemini-key'] || snap.status?.geminiKey),
    hasDiscordToken: Boolean(secrets?.['discord-bot-token']),
    refresh: refreshKeys,
  }
}

/** Which keys a tool needs before it can do real work. */
export function needsFor(slug: DaemonSlug): { analysis: boolean; image: boolean; discord: boolean } {
  return { analysis: slug !== 'thumbnail-daemon', image: slug === 'thumbnail-daemon', discord: slug === 'discord-daemon' }
}

/** True when this tool has every key it needs. Null while the server has not answered yet. */
export function toolReady(slug: DaemonSlug, keys: Keys): boolean | null {
  if (!keys.secrets && !keys.status) return null
  const need = needsFor(slug)
  return (!need.analysis || keys.hasAnalysisKey) && (!need.image || keys.hasImageKey) && (!need.discord || keys.hasDiscordToken)
}

/** Saves one pasted key on the server. sk-or- goes to OpenRouter (images and analysis); anything else is a Gemini key. */
export async function saveKey(key: string): Promise<SecretName> {
  const name: SecretName = detectProvider(key) === 'openrouter' ? 'openrouter-key' : 'gemini-key'
  await setSecret(name, key.trim())
  await refreshKeys()
  return name
}

export async function deleteKey(name: SecretName): Promise<void> {
  await removeSecret(name)
  await refreshKeys()
}

/** Which provider a pasted key belongs to. Mirrors the server: sk-or- is OpenRouter, anything else is Google. */
export function detectProvider(key: string): ImageProvider | null {
  const clean = key.trim()
  if (!clean) return null
  return clean.startsWith('sk-or-') ? 'openrouter' : 'google'
}

/** Display names for the two providers. */
export const PROVIDER_NAME: Record<ImageProvider, string> = { google: 'Gemini', openrouter: 'OpenRouter' }
