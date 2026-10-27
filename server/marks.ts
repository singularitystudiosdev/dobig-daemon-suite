import type { Store } from './store.ts'

/* Finding marks: what a user marked on a finding of a daemon ("filed", "dismissed", "patched", "contacted",
   "reviewed", ...). One file, marks.json (mode 0600, like the other stores): { [daemonId]: { [findingId]: state } }.
   A state is a short lowercase token; an empty or null state clears the mark. A daemon holds at most 500 marks. The
   Content Creator Daemon keeps its own pipeline marks elsewhere (server/tools/content-creator-pipeline.ts); what is
   stored here is only the row's chip state. */

const FILE = 'marks.json'
export const MAX_MARKS_PER_DAEMON = 500
const MAX_FINDING_ID = 200
const STATE = /^[a-z][a-z0-9-]{0,39}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

export type MarkMap = Record<string, string>
type All = Record<string, MarkMap>

export class MarksError extends Error {
  code: 'bad-input' | 'too-many'
  constructor(code: 'bad-input' | 'too-many', message: string) {
    super(message)
    this.name = 'MarksError'
    this.code = code
  }
}

/** Validates one mark. `state` null/empty/undefined clears. Returns the clean pair or one plain sentence. */
export function cleanMark(raw: unknown): { value: { findingId: string; state: string | null } } | { error: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { findingId?: unknown; state?: unknown }
  if (typeof o.findingId !== 'string' || o.findingId.length < 1 || o.findingId.length > MAX_FINDING_ID || CONTROL.test(o.findingId)) {
    return { error: `findingId must be 1 to ${MAX_FINDING_ID} characters with no control characters.` }
  }
  if (o.state === undefined || o.state === null || o.state === '') return { value: { findingId: o.findingId, state: null } }
  if (typeof o.state !== 'string' || !STATE.test(o.state)) return { error: 'state must be a short lowercase word (letters, digits and dashes, up to 40 characters), or empty to clear the mark.' }
  return { value: { findingId: o.findingId, state: o.state } }
}

export interface Marks {
  /** A copy of the daemon's marks (empty when it has none). */
  get(daemonId: string): MarkMap
  /** Sets (state string) or clears (null) one mark; returns the daemon's marks. Throws MarksError past 500 marks. */
  set(daemonId: string, findingId: string, state: string | null): MarkMap
  /** Drops every mark of a daemon (it was deleted). */
  clear(daemonId: string): void
}

const dict = (): MarkMap => Object.create(null) as MarkMap

function isAll(v: unknown): v is All {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((m) => !!m && typeof m === 'object' && !Array.isArray(m) && Object.values(m).every((s) => typeof s === 'string'))
}

export function createMarks(store: Store): Marks {
  // Null-prototype maps: a finding id such as "__proto__" is an ordinary key.
  const all = Object.create(null) as All
  for (const [daemonId, marks] of Object.entries(store.load<All>(FILE, {}, isAll))) {
    const m = dict()
    for (const [id, state] of Object.entries(marks)) if (id.length >= 1 && id.length <= MAX_FINDING_ID && STATE.test(state)) m[id] = state
    if (Object.keys(m).length > 0) all[daemonId] = m
  }

  const persist = () => {
    void store.save(FILE, all, { mode: 0o600 }).catch((err) => console.error('[marks] could not save:', err instanceof Error ? err.message : String(err)))
  }

  return {
    get: (daemonId) => ({ ...(all[daemonId] ?? {}) }),
    set(daemonId, findingId, state) {
      const m = all[daemonId] ?? dict()
      if (state === null) {
        delete m[findingId]
      } else {
        if (!(findingId in m) && Object.keys(m).length >= MAX_MARKS_PER_DAEMON) {
          throw new MarksError('too-many', `A daemon keeps at most ${MAX_MARKS_PER_DAEMON} marks. Clear some before adding more.`)
        }
        m[findingId] = state
      }
      if (Object.keys(m).length > 0) all[daemonId] = m
      else delete all[daemonId]
      persist()
      return { ...m }
    },
    clear(daemonId) {
      if (!(daemonId in all)) return
      delete all[daemonId]
      persist()
    },
  }
}
