import type { DaemonSlug } from '../../src/data/daemons.ts'
import type { Finding } from '../../src/lib/runTypes.ts'
import { sleep } from '../http.ts'
import { RunError, type Analyzer } from '../tools/types.ts'

/* Deterministic analyzers for tests (server/test/engine.mjs) and for the HTTP checks (DAEMON_FAKE_TOOLS). Nothing
   here ships in a product run: the plugin only loads this file when DAEMON_FAKE_TOOLS is set and NODE_ENV is not
   production. The behaviour is picked by the target name:
     fail-zero     step, then RunError('upstream')            (no findings: the charge is refunded)
     fail-partial  one finding, then RunError('upstream')     (kept: no refund)
     crash         throws a plain Error that mentions a key   (internal; the key must never reach a client)
     slow          waits up to 30 s, abortable                (delete / stop cancel it)
     wait:<ms>     waits that long, abortable, then finishes normally
   anything else: two findings f1, f2 on every run plus f3 from the second run on. */

function finding(id: string, title: string): Finding {
  return {
    id,
    badge: { label: 'Fake', tone: 'muted' },
    title,
    snippet: [{ text: `Fake finding ${id}` }],
    meta: [{ label: 'Id', value: id }],
    status: { label: 'Open', tone: 'muted' },
    detail: { kind: 'thumbnail', thumbId: '1', url: 'https://tr.rbxcdn.com/fake', isNew: false, firstSeen: new Date(0).toISOString(), position: 1 },
  }
}

const analyzer: Analyzer = async (ctx) => {
  const name = ctx.target.name
  ctx.step('read', 'Reading the source', 'active')
  if (name === 'fail-zero') {
    ctx.step('read', 'Reading the source', 'failed')
    throw new RunError('upstream', 'The fake source did not answer.', { kind: 'retry', label: 'Try again' })
  }
  if (name === 'crash') throw new Error('boom with sk-or-abcdefghijklmnop and internal path /srv/app')
  if (name === 'slow') await sleep(30_000, ctx.signal)
  const wait = /^wait:(\d+)$/.exec(name)
  if (wait) await sleep(Number(wait[1]), ctx.signal)
  ctx.step('read', 'Reading the source', 'done', 'fake data')

  const runs = (ctx.memory.get<number>('runs') ?? 0) + 1
  ctx.memory.set('runs', runs)
  ctx.summary({ items: [{ label: 'Run number', value: String(runs) }], sortLabel: 'Sorted by id' })
  ctx.finding(finding('f1', 'First'))
  if (name === 'fail-partial') throw new RunError('upstream', 'The fake source stopped halfway.')
  ctx.finding(finding('f2', 'Second'))
  if (runs >= 2) ctx.finding(finding('f3', 'Third'))
}

export const fakeAnalyzers: Record<DaemonSlug, Analyzer> = {
  'thumbnail-daemon': analyzer,
  'hack-daemon': analyzer,
  'dmca-daemon': analyzer,
  'discord-daemon': analyzer,
  'description-daemon': analyzer,
  'creator-dox': analyzer,
}
