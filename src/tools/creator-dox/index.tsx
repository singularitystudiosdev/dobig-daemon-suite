/* Creator Dox: a partnership dossier assembled from public channel data.
   Page shape: the lookup input, the run stage with the sponsorship split and its log aside,
   then the results tabs and the permanent "not collected" policy row. */

import { useMemo, useState, type FormEvent } from 'react'
import { Lock, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtCompact, fmtPct } from '@/lib/format'
import { useRoute } from '@/lib/router'
import { useSimulation, type SimStage } from '@/lib/useSimulation'
import { useActiveGame } from '@/context/ActiveGame'
import { daemonsBySlug } from '@/data/daemons'
import type { Game } from '@/data/games'
import { ToolPage } from '@/components/shell/ToolPage'
import { RunStage } from '@/components/shell/RunStage'
import { Avatar, Badge, Button, Field, Panel, TabPanel, Tabs, TextInput, useToast, type TabItem } from '@/components/ui'
import { creatorsFor, findCreator, fmtReach, type Creator } from './data'
import { CreatorAside, CreatorStage } from './stage'
import { Overview } from './tabs/Overview'
import { Engagement } from './tabs/Engagement'
import { Uploads } from './tabs/Uploads'
import { BrandCollabs } from './tabs/BrandCollabs'
import { Audience } from './tabs/Audience'
import { GameFit } from './tabs/GameFit'
import { Outreach } from './tabs/Outreach'

const STAGES: SimStage[] = [
  { id: 'resolve', label: 'Resolve handle', detail: 'Handle to channel id', duration: 1500 },
  { id: 'stats', label: 'Channel stats', detail: 'Subs, views, rank', duration: 2000 },
  { id: 'crawl', label: 'Crawl uploads', detail: '48 public uploads', duration: 4000 },
  { id: 'sponsor', label: 'Sponsorships', detail: 'The sponsorship split', duration: 4500 },
  { id: 'audience', label: 'Estimate audience', detail: 'Age and country', duration: 2500 },
  { id: 'credibility', label: 'Credibility scan', detail: 'Real reach', duration: 3000 },
  { id: 'score', label: 'Score', detail: 'Channel quality score', duration: 2000 },
  { id: 'compile', label: 'Compile dossier', detail: 'Refreshed weekly', duration: 1500 },
]

const TAB_ITEMS: TabItem<TabId>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'uploads', label: 'Uploads', count: 48 },
  { id: 'brand-collabs', label: 'Brand collabs' },
  { id: 'audience', label: 'Audience' },
  { id: 'game-fit', label: 'Game fit' },
  { id: 'outreach', label: 'Outreach' },
]

type TabId = 'overview' | 'engagement' | 'uploads' | 'brand-collabs' | 'audience' | 'game-fit' | 'outreach'

const TAB_IDS = new Set<string>(TAB_ITEMS.map((t) => t.id))

function tabFromFocus(focus: string | null): TabId {
  return focus && TAB_IDS.has(focus) ? (focus as TabId) : 'overview'
}

export default function Page() {
  const daemon = daemonsBySlug['creator-dox']
  const { game } = useActiveGame()
  const route = useRoute()
  const creators = useMemo(() => creatorsFor(game), [game])
  const [selected, setSelected] = useState(() => creators[0]?.handle ?? '')
  const [runSeq, setRunSeq] = useState(0)
  const focusTab = tabFromFocus(route.query.get('focus'))

  // A game change replaces the dataset, so an unknown selection falls back to the first creator.
  const creator = creators.find((c) => c.handle === selected) ?? creators[0]

  function pick(next: Creator) {
    setSelected(next.handle)
    setRunSeq((n) => n + 1)
  }

  return (
    <ToolPage daemon={daemon}>
      <Lookup creators={creators} game={game} selected={creator.handle} onPick={pick} />
      {creator && <DossierRun key={`${creator.handle}-${game.id}-${runSeq}`} creator={creator} game={game} initialTab={focusTab} />}
      <NotCollected />
    </ToolPage>
  )
}

function Lookup({
  creators,
  game,
  selected,
  onPick,
}: {
  creators: Creator[]
  game: Game
  selected: string
  onPick: (creator: Creator) => void
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { push } = useToast()

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = findCreator(creators, input)
    if (!found) {
      setError('No suggested creator matches that handle. Four fictional creators are loaded per game, and only those can be read.')
      push({ title: 'No channel to read', description: 'Pick one of the four suggested creators below.', tone: 'warn' })
      return
    }
    setError(null)
    setInput('')
    onPick(found)
  }

  return (
    <Panel
      title="Creator lookup"
      description={`Four fictional creators are loaded for ${game.shortName}. Picking one restarts the run on their public channel.`}
    >
      <form onSubmit={onSubmit} noValidate>
        <Field label="Look up a creator" hint="Public channel handles only. Creator Dox never looks up a private profile.">
          {(id) => (
            <div className="flex flex-col gap-8">
              <div className="flex flex-wrap items-center gap-8">
                <TextInput
                  id={id}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value)
                    setError(null)
                  }}
                  placeholder="@handle"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${id}-error` : undefined}
                  className="min-w-200 flex-1"
                />
                <Button type="submit" variant="primary" icon={Search}>
                  Look up creator
                </Button>
              </div>
              {error && (
                <p id={`${id}-error`} role="alert" className="text-label text-warn">
                  {error}
                </p>
              )}
            </div>
          )}
        </Field>
      </form>

      <div className="mt-16">
        <h3 className="text-label font-medium text-ink">Suggested for {game.shortName}</h3>
        <ul className="mt-8 grid gap-8 md:grid-cols-2 xl:grid-cols-4">
          {creators.map((c) => {
            const active = c.handle === selected
            return (
              <li key={c.handle}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  aria-pressed={active}
                  className={cn(
                    'state-layer flex w-full items-center gap-8 rounded-8 border px-12 py-8 text-left transition-colors duration-150',
                    active ? 'border-accent-ink bg-accent-soft' : 'border-line bg-raised',
                  )}
                >
                  <Avatar name={c.handle} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-label text-ink">{c.handle}</span>
                    <span className="block truncate text-micro text-muted">
                      {fmtReach(c.dossier.subscribers)} subs, {fmtPct(c.dossier.erOrganic)} ER
                    </span>
                  </span>
                  <Badge tone={c.dossier.cqs.total >= 74 ? 'live' : c.dossier.cqs.total >= 66 ? 'accent' : 'warn'}>{c.dossier.grade}</Badge>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Panel>
  )
}

function DossierRun({ creator, game, initialTab }: { creator: Creator; game: Game; initialTab: TabId }) {
  const sim = useSimulation(STAGES)
  const [tab, setTab] = useState<TabId>(initialTab)
  const go = (id: string) => setTab(TAB_IDS.has(id) ? (id as TabId) : 'overview')

  return (
    <>
      <RunStage
        sim={sim}
        daemon="creator-dox"
        title="Creator dossier run"
        subtitle={`${creator.handle} for ${game.shortName}`}
        aside={<CreatorAside sim={sim} creator={creator} game={game} />}
      >
        <CreatorStage sim={sim} creator={creator} game={game} />
      </RunStage>

      <Panel
        title="Dossier results"
        description={`Everything below is public channel data for ${creator.handle}, as of 26 October 2026. Modelled values carry a label and never a fake-precise figure.`}
        actions={<Badge tone="muted">Refreshed weekly</Badge>}
      >
        <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} idPrefix="creator-dox" ariaLabel="Dossier sections" />
        <div className="pt-24">
          {tab === 'overview' && (
            <TabPanel idPrefix="creator-dox" id="overview">
              <Overview creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
          {tab === 'engagement' && (
            <TabPanel idPrefix="creator-dox" id="engagement">
              <Engagement creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
          {tab === 'uploads' && (
            <TabPanel idPrefix="creator-dox" id="uploads">
              <Uploads creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
          {tab === 'brand-collabs' && (
            <TabPanel idPrefix="creator-dox" id="brand-collabs">
              <BrandCollabs creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
          {tab === 'audience' && (
            <TabPanel idPrefix="creator-dox" id="audience">
              <Audience creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
          {tab === 'game-fit' && (
            <TabPanel idPrefix="creator-dox" id="game-fit">
              <GameFit creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
          {tab === 'outreach' && (
            <TabPanel idPrefix="creator-dox" id="outreach">
              <Outreach creator={creator} game={game} onNavigate={go} />
            </TabPanel>
          )}
        </div>
      </Panel>
    </>
  )
}

function NotCollected() {
  return (
    <section aria-label="Not collected" className="flex items-start gap-12 rounded-20 border border-line bg-surface px-24 py-16">
      <Lock aria-hidden className="mt-2 size-16 shrink-0 text-muted" />
      <div className="min-w-0">
        <h2 className="text-title font-bold text-ink">Not collected: home address, phone, family, private data</h2>
        <p className="mt-4 max-w-prose text-label text-muted">
          The dossier is built from public channel analytics, public upload metadata and the public business address on the About page. Country is the finest location ever reported. No real-name lookup, no phone, no family, no school and no home address is read, inferred or stored.
        </p>
      </div>
    </section>
  )
}
