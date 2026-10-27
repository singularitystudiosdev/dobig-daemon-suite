import { AudioLines, Box, ChevronRight, CircleCheck, Circle, Image as ImageIcon, Scale } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clamp, fmtDay } from '@/lib/format'
import { createRng } from '@/lib/random'
import type { Simulation } from '@/lib/useSimulation'
import type { Game } from '@/data/games'
import { Badge } from '@/components/ui'
import { Sorter, currentItem } from './Sorter'
import { CHECKLIST_512C3, RM_PATH, shortHash, type AssetKind, type Dataset, type RegisteredAsset } from './data'

export const kindIcon: Record<AssetKind, typeof Box> = { mesh: Box, image: ImageIcon, audio: AudioLines }

/* Everything inside the run stage's main column: the 512(f) banner (always on top), the
   fingerprint chips, the sorter, and the filing and tracking strip. */
export function Stage({ sim, data, game, reduced }: { sim: Simulation; data: Dataset; game: Game; reduced: boolean }) {
  return (
    <div className="flex flex-col gap-16">
      <div role="note" className="flex items-start gap-12 rounded-8 border border-warn bg-warn-soft px-16 py-12">
        <Scale aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
        <p className="text-label text-ink">
          <span className="font-bold">17 U.S.C. 512(f):</span> knowingly misrepresenting that material is infringing makes the filer liable for damages, costs and attorneys' fees. Auto-file
          covers byte-identical hash matches only; every perceptual match goes to a person.
        </p>
      </div>
      <Fingerprints sim={sim} data={data} />
      <Sorter sim={sim} data={data} game={game} reduced={reduced} />
      <FilingStrip sim={sim} data={data} />
    </div>
  )
}

function Fingerprints({ sim, data }: { sim: Simulation; data: Dataset }) {
  const p = sim.within('fingerprint')
  const cur = currentItem(data, sim)
  const lit = cur?.c.lane === 'auto-file' ? cur.asset?.assetId : undefined
  const shown = data.assets.slice(0, 3)
  const more = data.assets.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-8">
      <h3 className="mr-4 text-label font-medium text-ink">Registered fingerprints</h3>
      {shown.map((a, i) => (
        <Chip key={a.assetId} asset={a} appear={sim.status !== 'idle' && p >= i * 0.22} resolved={sim.status !== 'idle' && p >= i * 0.22 + 0.2} lit={lit === a.assetId} t={sim.t} />
      ))}
      {sim.status !== 'idle' && p >= 0.85 && <span className="text-micro text-muted motion-safe:animate-enter">+{more} more in the family</span>}
      <p className="ml-auto text-micro text-subtle">Family has 12 approved images: Roblox-side matching active (10 or more required)</p>
    </div>
  )
}

function Chip({ asset, appear, resolved, lit, t }: { asset: RegisteredAsset; appear: boolean; resolved: boolean; lit: boolean; t: number }) {
  const Icon = kindIcon[asset.kind]
  // While hashing, the digest scrambles deterministically from the script clock.
  const scramble = createRng(asset.assetId + Math.floor(t / 80)).hex(8)
  const hash = resolved ? shortHash(asset.sha256) : `${scramble.slice(0, 4)}…${scramble.slice(4)}`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-8 rounded-8 border px-8 py-4 transition-opacity duration-200 motion-reduce:transition-none',
        lit ? 'border-live bg-live-soft' : 'border-line bg-raised',
        appear ? 'opacity-100' : 'opacity-0',
      )}
    >
      <Icon aria-hidden className="size-16 shrink-0 text-muted" />
      <span className="text-micro font-medium text-ink">{asset.name}</span>
      <span className={cn('tabular font-mono text-micro', lit ? 'text-live' : resolved ? 'text-muted' : 'text-subtle')}>sha256 {hash}</span>
    </span>
  )
}

function FilingStrip({ sim, data }: { sim: Simulation; data: Dataset }) {
  const fp = sim.within('file')
  const submitted = fp >= 0.85
  const tp = sim.within('track')
  const flipped = tp >= 0.45
  const bar = clamp((tp - 0.45) / 0.4)
  const lw = data.lastWeek
  const approved = lw.approved ?? 0
  const rejected = lw.rejected ?? 0
  return (
    <div className="grid gap-12 md:grid-cols-5">
      <div className="min-w-0 rounded-8 border border-line p-12 md:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-8">
          <h3 className="text-label font-medium text-ink">Notice under 17 U.S.C. 512(c)(3)</h3>
          <span className="flex items-center gap-4 text-micro text-muted">
            {RM_PATH.map((seg, i) => (
              <span key={seg} className="flex items-center gap-4">
                {i > 0 && <ChevronRight aria-hidden className="size-12 text-subtle" />}
                {seg}
              </span>
            ))}
          </span>
        </div>
        <ol className="mt-8 grid gap-x-16 gap-y-4 sm:grid-cols-2">
          {CHECKLIST_512C3.map((row, i) => {
            const done = fp >= 0.08 + i * 0.09
            const Icon = done ? CircleCheck : Circle
            return (
              <li key={row.roman} className="flex items-start gap-8 text-micro">
                <Icon aria-hidden className={cn('mt-2 size-12 shrink-0', done ? 'text-live' : 'text-subtle')} />
                <span className="w-36 shrink-0 font-mono text-muted">{row.roman}</span>
                <span className={done ? 'text-ink' : 'text-subtle'}>
                  {row.label}
                  <span className="sr-only">{done ? ', checked' : ', not yet checked'}</span>
                </span>
              </li>
            )
          })}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-8 border-t border-line pt-8 text-micro">
          <span className="font-mono text-ink">{data.requestA}</span>
          {submitted ? (
            <>
              <Badge tone="warn">Pending</Badge>
              <span className="text-subtle">No edits after submit</span>
            </>
          ) : (
            <Badge tone="muted">{sim.reached('file') ? 'Drafting' : 'Not started'}</Badge>
          )}
        </div>
      </div>
      <div className="min-w-0 rounded-8 bg-raised p-12 md:col-span-2">
        <h3 className="text-label font-medium text-ink">Last week's request</h3>
        <div className="mt-8 flex flex-wrap items-center gap-8 text-micro">
          <span className="font-mono text-ink">{lw.name}</span>
          <span className="text-muted">
            {lw.links} links, submitted {fmtDay(lw.submittedAt)}
          </span>
        </div>
        <div className="mt-8 flex items-center gap-8">
          {flipped ? (
            <span className="motion-safe:animate-stamp">
              <Badge tone="live">Approved</Badge>
            </span>
          ) : (
            <Badge tone="warn">Pending</Badge>
          )}
          {flipped && (
            <span className="tabular text-label text-ink motion-safe:animate-enter">
              <span className="text-live">Approved {approved}</span>, <span className="text-danger">Rejected {rejected}</span>
            </span>
          )}
        </div>
        <div className="mt-8 flex h-6 gap-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${approved} links approved and ${rejected} rejected out of ${lw.links}`}>
          <span className="h-full origin-left rounded-full bg-live" style={{ width: `${(approved / lw.links) * 100}%`, transform: `scaleX(${bar})` }} />
          <span className="h-full origin-left rounded-full bg-danger" style={{ width: `${(rejected / lw.links) * 100}%`, transform: `scaleX(${bar})` }} />
        </div>
        <p className="mt-8 text-micro text-subtle">{flipped ? lw.note : 'Polling Rights Manager status'}</p>
      </div>
    </div>
  )
}
