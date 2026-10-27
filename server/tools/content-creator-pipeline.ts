/* The owner's pipeline marks for the Content Creator Daemon: Contacted, Replied, Back to new. The detail view posts a mark to
   this module's routes; the analyzer reads the marks at every run so creators already seen keep them. The marks live in
   their own small file under the data directory (one file per daemon, never anything but a channel id and a word), so a
   rerun, a restart or a page reload does not lose them. */
import path from 'node:path'
import type { ContentCreatorMark } from '../../src/lib/details/content-creator.ts'
import { createStore, resolveDataDir, type Store } from '../store.ts'
import type { RouteContext, ToolModule } from './types.ts'

export interface MarkRecord {
  mark: ContentCreatorMark
  /** ISO time the owner set it. */
  at: string
}

const MARKS: ContentCreatorMark[] = ['new', 'contacted', 'replied']
const DAEMON_ID = /^[A-Za-z0-9_-]{1,64}$/
const CHANNEL_ID = /^UC[\w-]{20,24}$/

let store: Store | null = null
const getStore = (): Store => (store ??= createStore(path.join(resolveDataDir(process.cwd(), process.env.DAEMON_DATA_DIR), 'content-creator')))
const file = (daemonId: string): string => `marks-${daemonId}.json`
const isMarks = (v: unknown): v is Record<string, MarkRecord> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every mark the owner set for this daemon, by channel id. Empty for an unknown daemon id. */
export function readMarks(daemonId: string): Record<string, MarkRecord> {
  if (!DAEMON_ID.test(daemonId)) return {}
  const all = getStore().load<Record<string, MarkRecord>>(file(daemonId), {}, isMarks)
  const out: Record<string, MarkRecord> = {}
  for (const [id, r] of Object.entries(all)) if (CHANNEL_ID.test(id) && r && MARKS.includes(r.mark)) out[id] = r
  return out
}

export async function setMark(daemonId: string, channelId: string, mark: ContentCreatorMark): Promise<void> {
  const all = readMarks(daemonId)
  all[channelId] = { mark, at: new Date().toISOString() }
  await getStore().save(file(daemonId), all)
}

const bad = (ctx: RouteContext, message: string): void => ctx.json(400, { ok: false, code: 'bad-input', message })

async function getMarks(ctx: RouteContext): Promise<void> {
  const daemonId = ctx.url.searchParams.get('daemon') ?? ''
  if (!DAEMON_ID.test(daemonId)) return bad(ctx, 'Pass the daemon id as ?daemon=.')
  const marks: Record<string, ContentCreatorMark> = {}
  for (const [id, r] of Object.entries(readMarks(daemonId))) marks[id] = r.mark
  ctx.json(200, { ok: true, marks })
}

async function postMark(ctx: RouteContext): Promise<void> {
  const body = (await ctx.body()) as { daemonId?: unknown; channelId?: unknown; mark?: unknown } | undefined
  const daemonId = typeof body?.daemonId === 'string' ? body.daemonId : ''
  const channelId = typeof body?.channelId === 'string' ? body.channelId : ''
  const mark = typeof body?.mark === 'string' ? (body.mark as ContentCreatorMark) : undefined
  if (!DAEMON_ID.test(daemonId) || !CHANNEL_ID.test(channelId) || !mark || !MARKS.includes(mark)) return bad(ctx, 'Send daemonId, channelId and a mark of new, contacted or replied.')
  await setMark(daemonId, channelId, mark)
  ctx.json(200, { ok: true })
}

export const pipelineRoutes: NonNullable<ToolModule['routes']> = {
  'GET /api/content-creator/marks': getMarks,
  'POST /api/content-creator/mark': postMark,
}
