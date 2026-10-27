import type { ImageProvider } from '../src/lib/apiTypes.ts'
import type { Secrets } from './tools/types.ts'

/* Where each key comes from. Environment wins over the key dialog (secrets.json) so a developer's keychain launch
   keeps working; a key saved later is picked up on the next call because nothing here caches. */

export interface KeyEnv {
  /** GEMINI_API_KEY */
  key: string
  /** OPENROUTER_API_KEY */
  openrouterKey: string
}

const KEY_SHAPE = /^[A-Za-z0-9_-]{6,256}$/
const OPENROUTER_PREFIX = 'sk-or-'

/** The provider a key belongs to: OpenRouter keys start with sk-or-, anything else is a Gemini key. */
export function providerForKey(key: string): ImageProvider {
  return key.startsWith(OPENROUTER_PREFIX) ? 'openrouter' : 'google'
}

/** OpenRouter key for analysis calls: env OPENROUTER_API_KEY, else the saved 'openrouter-key'. '' when none. */
export function resolveLlmKey(env: KeyEnv, secrets: Secrets): string {
  return env.openrouterKey || secrets.get('openrouter-key') || ''
}

export interface ImageKey {
  key: string
  provider: ImageProvider
}

/** Image key: browser header x-gemini-key, else env GEMINI_API_KEY, env OPENROUTER_API_KEY, secret gemini-key, secret openrouter-key. */
export function resolveImageKey(headerKey: string, env: KeyEnv, secrets: Secrets): ImageKey | null {
  const h = headerKey.trim()
  if (h && KEY_SHAPE.test(h)) return { key: h, provider: providerForKey(h) }
  if (env.key) return { key: env.key, provider: 'google' }
  if (env.openrouterKey) return { key: env.openrouterKey, provider: 'openrouter' }
  const gem = secrets.get('gemini-key')
  if (gem) return { key: gem, provider: providerForKey(gem) }
  const or = secrets.get('openrouter-key')
  if (or) return { key: or, provider: 'openrouter' }
  return null
}
