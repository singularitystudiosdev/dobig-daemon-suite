import type { Store } from './store.ts'
import { redactKeys } from './http.ts'
import type { SecretName, Secrets } from './tools/types.ts'

/* Server-side secrets (secrets.json, mode 0600). A value is returned only to server code through get(); the HTTP
   routes expose which names exist, never a value, and nothing here logs one. */

export const SECRET_NAMES: readonly SecretName[] = ['discord-bot-token', 'openrouter-key', 'gemini-key', 'roblox-open-cloud-key']
export const MAX_SECRET_LENGTH = 512

export function isSecretName(value: unknown): value is SecretName {
  return typeof value === 'string' && (SECRET_NAMES as readonly string[]).includes(value)
}

export interface SecretStore extends Secrets {
  set(name: SecretName, value: string): Promise<void>
  remove(name: SecretName): Promise<void>
  /** Which secrets exist (presence only). */
  presence(): Record<SecretName, boolean>
  /** Removes every stored secret value (and key-shaped strings) from text bound for a log or a client. */
  scrub(text: string): string
}

/** Trims and validates a value a user sent; returns the clean value or an error message. */
export function cleanSecretValue(raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'The value must be text.' }
  const value = raw.trim()
  if (!value) return { error: 'The value is empty. Paste the key or token and try again.' }
  if (value.length > MAX_SECRET_LENGTH) return { error: `That value is longer than ${MAX_SECRET_LENGTH} characters, so it cannot be a key or token.` }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { error: 'The value contains line breaks or control characters. Paste only the key or token.' }
  return { value }
}

const FILE = 'secrets.json'

export function createSecrets(store: Store): SecretStore {
  const raw = store.load<Record<string, unknown>>(FILE, {}, (v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
  const values: Partial<Record<SecretName, string>> = {}
  for (const name of SECRET_NAMES) {
    const v = raw[name]
    if (typeof v === 'string' && v) values[name] = v
  }
  const persist = () => store.save(FILE, values, { mode: 0o600 })
  void persist() // creates the file with mode 0600 even before the first secret is saved

  return {
    get: (name) => values[name] ?? null,
    has: (name) => Boolean(values[name]),
    set(name, value) {
      values[name] = value
      return persist()
    },
    remove(name) {
      delete values[name]
      return persist()
    },
    presence: () => Object.fromEntries(SECRET_NAMES.map((n) => [n, Boolean(values[n])])) as Record<SecretName, boolean>,
    scrub(text) {
      let out = text
      for (const v of Object.values(values)) if (v && v.length >= 6) out = out.split(v).join('[redacted]')
      return redactKeys(out)
    },
  }
}
