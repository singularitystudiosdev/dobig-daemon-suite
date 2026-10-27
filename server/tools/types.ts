import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DaemonSlug } from '../../src/data/daemons.ts'
import type { Finding, RunAction, RunErrorCode, RunSummary, StepState, Target } from '../../src/lib/runTypes.ts'
import type { Llm } from '../llm.ts'

/* What a tool analyzer is given and what it may do. An analyzer is plain async code: it reports real progress
   through ctx.step, streams its results through ctx.finding, and throws a RunError when it cannot continue.
   The run engine (server/runs.ts) owns persistence, credits, scheduling and streaming; an analyzer never
   touches any of that. */

export class RunError extends Error {
  code: RunErrorCode
  action?: RunAction
  constructor(code: RunErrorCode, message: string, action?: RunAction) {
    super(message)
    this.name = 'RunError'
    this.code = code
    this.action = action
  }
}

export type SecretName = 'discord-bot-token' | 'openrouter-key' | 'gemini-key' | 'roblox-open-cloud-key'

export interface Secrets {
  get(name: SecretName): string | null
  has(name: SecretName): boolean
}

/** Per-daemon memory that survives between runs (known ids, earlier drafts, cursors). JSON values only. */
export interface Memory {
  get<T>(key: string): T | undefined
  set(key: string, value: unknown): void
}

export interface RunContext {
  tool: DaemonSlug
  target: Target
  trigger: 'user' | 'schedule'
  runId: string
  daemonId: string
  now: Date
  /** Aborted when the daemon is deleted or the server stops. Pass it to every fetch. */
  signal: AbortSignal
  /** Report real progress. Call with 'active' when a step starts, then again with the same id and its final state. */
  step(id: string, label: string, state: StepState, detail?: string): void
  /** The strip of real counts above the list, the sort label, filter groups and any notices. Call once, early or late. */
  summary(summary: RunSummary): void
  /** Stream one finding. Use ids that are stable across runs for the same underlying thing. */
  finding(finding: Finding): void
  llm: Llm
  secrets: Secrets
  memory: Memory
  /** Findings of the previous finished run of this daemon (empty on the first run), for diffing and memory. */
  previous: Finding[]
}

export type Analyzer = (ctx: RunContext) => Promise<void>

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  /** Parsed JSON body (max 256 KB), or undefined when there is none. */
  body(): Promise<unknown>
  json(status: number, data: unknown): void
  secrets: Secrets & { set(name: SecretName, value: string): void; remove(name: SecretName): void }
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>

/** What a tool module exports. `routes` keys look like 'GET /api/discord/resolve'. */
export interface ToolModule {
  analyze: Analyzer
  routes?: Record<string, RouteHandler>
}
