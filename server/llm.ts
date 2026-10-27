import { RunError } from './tools/types.ts'

/* Structured-output LLM calls through OpenRouter's chat completions API (https://openrouter.ai/docs).
   Used by the tool analyzers to classify, cluster, summarise and draft. The model returns JSON that must match
   the supplied JSON Schema; this client validates the shape it can (parseable JSON) and the caller validates the rest. */

export const DEFAULT_ANALYSIS_MODEL = 'anthropic/claude-haiku-5.5'

export type JsonSchema = Record<string, unknown>

export interface LlmRequest {
  /** Names the schema for the provider; letters, digits and underscores. */
  name: string
  system: string
  user: string
  schema: JsonSchema
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface LlmResult<T> {
  data: T
  /** What OpenRouter billed for the call, in USD, when it reports it. */
  costUsd: number | null
  model: string
}

export interface Llm {
  /** False when the server has no OpenRouter key: every call then throws RunError('no-llm-key'). */
  available: boolean
  model: string
  json<T>(req: LlmRequest, signal?: AbortSignal): Promise<LlmResult<T>>
}

export interface LlmEnv {
  /** OpenRouter key, or '' when none. */
  key: string
  baseUrl: string
  model: string
}

const NO_KEY = new RunError('no-llm-key', 'This tool needs an OpenRouter key to analyse results. Add one in the key dialog, or start the server with npm run dev:keychain.', {
  kind: 'add-key',
  label: 'Add a key',
})

function scrub(text: string, key: string): string {
  let out = text.replace(/sk-or-[A-Za-z0-9_-]{8,}/g, '<key>')
  if (key) out = out.split(key).join('<key>')
  return out
}

/** Parse a model's text as JSON, tolerating a ```json fence or leading prose. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim()
  try {
    return JSON.parse(t)
  } catch {
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenced) return JSON.parse(fenced[1].trim())
    const first = t.indexOf('{')
    const last = t.lastIndexOf('}')
    if (first >= 0 && last > first) return JSON.parse(t.slice(first, last + 1))
    throw new Error('The model did not return JSON.')
  }
}

export function createLlm(env: LlmEnv): Llm {
  const base = env.baseUrl.replace(/\/+$/, '')
  return {
    available: env.key.length > 0,
    model: env.model,
    async json<T>(req: LlmRequest, signal?: AbortSignal): Promise<LlmResult<T>> {
      if (!env.key) throw NO_KEY
      const model = req.model ?? env.model
      const body = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: req.schema } },
        max_tokens: req.maxTokens ?? 4000,
        temperature: req.temperature ?? 0.2,
        usage: { include: true },
      }
      let lastErr: RunError | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) throw new RunError('aborted', 'The run was cancelled.')
        let res: Response
        try {
          res = await fetch(`${base}/api/v1/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${env.key}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
          })
        } catch (err) {
          if (signal?.aborted) throw new RunError('aborted', 'The run was cancelled.')
          lastErr = new RunError('upstream', 'OpenRouter did not answer. Try again in a moment.')
          void err
          continue
        }
        const text = await res.text()
        if (res.status === 401) throw new RunError('no-llm-key', 'OpenRouter rejected the API key. Check the key and try again.', { kind: 'add-key', label: 'Add a key' })
        if (res.status === 402) throw new RunError('credits', 'Your OpenRouter account is out of credits. Add credits at openrouter.ai/credits.', { kind: 'open-url', label: 'Open OpenRouter credits', url: 'https://openrouter.ai/credits' })
        if (res.status === 429 || res.status >= 500) {
          const wait = Math.min(8000, (Number(res.headers.get('retry-after')) || 2 ** attempt) * 1000)
          lastErr = new RunError(res.status === 429 ? 'rate-limited' : 'upstream', res.status === 429 ? 'OpenRouter is rate limiting analysis. Try again in a minute.' : 'OpenRouter had a server error. Try again in a moment.')
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        let json: { choices?: { message?: { content?: string } }[]; usage?: { cost?: number }; error?: { message?: string } }
        try {
          json = JSON.parse(text)
        } catch {
          throw new RunError('upstream', 'OpenRouter returned something that is not JSON.')
        }
        if (!res.ok) throw new RunError('upstream', scrub(json.error?.message ?? `OpenRouter answered ${res.status}.`, env.key).slice(0, 240))
        const content = json.choices?.[0]?.message?.content
        if (!content) {
          lastErr = new RunError('upstream', 'The analysis model returned no answer.')
          continue
        }
        try {
          return { data: parseJsonLoose(content) as T, costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : null, model }
        } catch {
          lastErr = new RunError('upstream', 'The analysis model returned an answer that was not valid JSON.')
          continue
        }
      }
      throw lastErr ?? new RunError('upstream', 'The analysis call failed.')
    },
  }
}
