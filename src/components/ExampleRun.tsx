import { useState, type ReactNode } from 'react'
import { ExternalLink, Info, MessagesSquare } from 'lucide-react'
import { Skeleton, SkeletonRows, StatPill } from '@/components/ui'
import { ToolHero } from '@/components/ToolHero'
import { toolsBySlug } from '@/data/tools'
import { FindingsList } from '@/demo/findings/FindingsList'
import { fmtInt } from '@/lib/format'
import { heroSrc, type ToolExample } from '@/lib/example'
import type { RunSummary } from '@/lib/runTypes'

/* The read-only example run on the Pages tool page: a real captured run of one tool on a real game, shown the way the
   dashboard shows it. Nothing here is invented; every number comes from the captured file. The findings are the real
   FindingsList (daemonId 'example'), so a visitor can open real rows and read the real detail views. */

const capturedLabel = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** A file written with a bare list of items is read as the items of a summary with no sort line. */
function normalizeSummary(raw: unknown): RunSummary | null {
  if (!raw) return null
  if (Array.isArray(raw)) return { items: raw, sortLabel: '' }
  const r = raw as Partial<RunSummary>
  return { ...r, items: Array.isArray(r.items) ? r.items : [], sortLabel: r.sortLabel ?? '' }
}

const SectionTitle = ({ children }: { children: ReactNode }) => <h2 className="text-title font-bold text-ink">{children}</h2>

/** The real summary items of the run, as the same label and value pairs the findings list uses. */
function RunFacts({ summary, className }: { summary: RunSummary; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <SectionTitle>What this run did</SectionTitle>
      <ul aria-label="What this run did" className={className ?? 'flex flex-col gap-8'}>
        {summary.items.map((s) => (
          <li key={s.label} className="min-w-0">
            <StatPill label={s.label} value={s.value} tone={s.tone} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function VariantPic({ url, caption }: { url: string; caption: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <figure className="relative aspect-video min-w-0 overflow-hidden rounded-8 bg-raised">
      {!failed && (
        <img src={heroSrc(url)} alt={caption} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
      )}
      <figcaption className="absolute bottom-8 left-8 rounded-full bg-canvas px-8 py-2 text-micro font-medium text-ink">{caption}</figcaption>
    </figure>
  )
}

/** Thumbnail Daemon: the real original beside the variants generated from it, and the exact prompt. */
function VariantsGrid({ variants }: { variants: NonNullable<ToolExample['variants']> }) {
  return (
    <div className="flex min-w-0 flex-col gap-12">
      <SectionTitle>The original and {variants.items.length === 3 ? 'three' : variants.items.length} generated variants</SectionTitle>
      <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
        <VariantPic url={variants.original} caption="Original" />
        {variants.items.map((url, i) => (
          <VariantPic key={url} url={url} caption={`Variant ${i + 1}`} />
        ))}
      </div>
      <figure className="flex max-w-prose flex-col gap-6 border-l-2 border-line-strong pl-16">
        <figcaption className="text-micro text-subtle">The exact prompt used for every variant</figcaption>
        <blockquote className="whitespace-pre-line text-label text-muted">{variants.prompt}</blockquote>
      </figure>
    </div>
  )
}

/** Discord Daemon: the real public lookup of the game's own server. */
function ServerCard({ server }: { server: NonNullable<ToolExample['server']> }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-16 rounded-8 border border-line bg-surface p-16">
      <div className="flex min-w-0 items-center gap-16">
        <div className="relative size-64 shrink-0 overflow-hidden rounded-8 bg-raised">
          {server.iconUrl && !failed ? (
            <img src={server.iconUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover" />
          ) : (
            <MessagesSquare aria-hidden className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 text-muted" />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-title font-bold text-ink">{server.name}</h3>
          <p className="text-label text-muted">Official Discord server</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <StatPill label="Members" value={server.members === null ? 'Not shown' : fmtInt(server.members)} />
        <StatPill label="Online" value={server.online === null ? 'Not shown' : fmtInt(server.online)} tone="live" />
      </div>
      <a
        href={server.inviteUrl}
        target="_blank"
        rel="noreferrer"
        className="state-layer inline-flex h-40 w-fit max-w-full items-center gap-8 rounded-8 border border-line bg-raised px-16 text-label font-medium text-ink"
      >
        <ExternalLink aria-hidden className="size-16 shrink-0" />
        <span className="truncate">{server.inviteUrl.replace(/^https?:\/\//, '')}</span>
      </a>
    </div>
  )
}

/** The labelled strip between the picture and the findings: what this is, when, and that it is read-only. */
function Strip({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-12 rounded-8 border border-line bg-raised px-16 py-12 text-label text-muted">
      <Info aria-hidden className="mt-2 size-16 shrink-0 text-accent-ink" />
      <span className="min-w-0 max-w-prose">{children}</span>
    </p>
  )
}

/** Shown while the example file loads: the same shapes the loaded page has. */
export function ExampleSkeleton() {
  return (
    <div aria-busy aria-label="Loading the example run" className="flex flex-col gap-32">
      <div className="grid grid-cols-1 gap-24 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Skeleton className="aspect-video w-full" />
        <div className="flex flex-col gap-8">
          <Skeleton className="mb-4 h-24 w-48" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-48 w-full" />
      <div className="rounded-20 border border-line bg-surface px-24 py-16">
        <SkeletonRows rows={4} />
      </div>
    </div>
  )
}

export function ExampleRun({ example }: { example: ToolExample }) {
  const tool = toolsBySlug[example.tool]
  const when = capturedLabel(example.capturedAt)
  const run = normalizeSummary(example.summary)
  const summary = run && run.items.length > 0 ? run : null
  const hero = example.hero.length > 0 ? example.hero : null
  const discord = example.tool === 'discord-daemon' ? example.server : undefined
  const variants = example.variants

  // The pills already sit in "What this run did"; the list keeps the sort line, the counting notes and the notices.
  const listSummary = run ? { ...run, items: [] } : null

  const picture = hero && (
    <div className="flex min-w-0 flex-col gap-12">
      <ToolHero images={hero} />
      {example.heroNote && <p className="max-w-prose text-label text-muted">{example.heroNote}</p>}
    </div>
  )

  return (
    <div className="flex flex-col gap-32">
      {variants ? (
        <div className="flex flex-col gap-32">
          <VariantsGrid variants={variants} />
          {summary && <RunFacts summary={summary} className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" />}
        </div>
      ) : discord ? (
        <div className="grid grid-cols-1 gap-24 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {picture ?? <div />}
          <div className="flex min-w-0 flex-col gap-12">
            <SectionTitle>The server</SectionTitle>
            <ServerCard server={discord} />
          </div>
        </div>
      ) : picture || summary ? (
        <div className={picture && summary ? 'grid grid-cols-1 gap-24 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : 'flex flex-col gap-24'}>
          {picture}
          {summary && <RunFacts summary={summary} />}
        </div>
      ) : null}

      {discord ? (
        <Strip>
          Example from a real lookup of {example.game.name}&rsquo;s official server{when ? `, captured ${when}` : ''}. It is read-only.{' '}
          {example.note ? example.note.split(/(?<=\.)\s+/)[0] : 'The tool needs your own bot, so there is no public run.'}
        </Strip>
      ) : (
        <Strip>
          Example from a real run on {example.game.name}
          {when ? `, captured ${when}` : ''}. It is read-only.
        </Strip>
      )}

      {!discord && example.findings.length > 0 && (
        <FindingsList title={tool.resultsTitle} findings={example.findings} summary={listSummary} running={false} tool={example.tool} daemonId="example" />
      )}
    </div>
  )
}

