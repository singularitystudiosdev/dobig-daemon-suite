import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Game } from '@/data/games'
import { daemonsBySlug } from '@/data/daemons'
import { busFor } from '@/data/bus'
import { useActiveGame } from '@/context/ActiveGame'
import { useRoute } from '@/lib/router'
import { useSimulation } from '@/lib/useSimulation'
import { ToolPage } from '@/components/shell/ToolPage'
import { RunStage } from '@/components/shell/RunStage'
import { Panel, TabPanel, Tabs, useToast, type TabItem } from '@/components/ui'
import { STAGES, T, buildDataset, type DevBrief, type PatchStatus } from './data'
import { ExploitMap } from './ExploitMap'
import { BriefDeal, QueryBar, RunAside } from './StageParts'
import { Gate, viewT } from './shared'
import { ClustersTab } from './tabs/ClustersTab'
import { BriefsTab } from './tabs/BriefsTab'
import { SourcesTab } from './tabs/SourcesTab'
import { ProfilesTab } from './tabs/ProfilesTab'
import { QuotaTab } from './tabs/QuotaTab'

type TabId = 'clusters' | 'briefs' | 'sources' | 'profiles' | 'quota'

function tabForFocus(focus: string | null): TabId {
  if (!focus) return 'clusters'
  if (focus.startsWith('cluster')) return 'clusters'
  if (focus === 'briefs' || focus === 'sources' || focus === 'profiles' || focus === 'quota') return focus
  return 'clusters'
}

export default function Page() {
  const daemon = daemonsBySlug['hack-daemon']
  const { game } = useActiveGame()
  return (
    <ToolPage daemon={daemon}>
      <HackRun key={game.id} game={game} />
    </ToolPage>
  )
}

function HackRun({ game }: { game: Game }) {
  const data = useMemo(() => buildDataset(game), [game])
  const sim = useSimulation(STAGES)
  const toast = useToast()
  const { query } = useRoute()
  const focus = query.get('focus')
  const [tab, setTab] = useState<TabId>(() => tabForFocus(focus))
  useEffect(() => setTab(tabForFocus(focus)), [focus])

  const [overrides, setOverrides] = useState<Record<string, PatchStatus>>({})
  const statusOf = useCallback((b: DevBrief) => overrides[b.clusterId] ?? b.status, [overrides])
  const markPatched = (b: DevBrief) => {
    const c = data.clusters.find((x) => x.id === b.clusterId)!
    setOverrides((o) => ({ ...o, [b.clusterId]: 'patched' }))
    toast.push({ title: `${c.cls} marked patched`, description: `${c.system} on ${game.shortName}. Hack Daemon keeps watching for new videos of this cluster.`, tone: 'ok' })
  }

  const moodDrop = useMemo(() => busFor(game).find((e) => e.kind === 'mood-drop'), [game])
  const t = viewT(sim)
  const filtered = data.sources.length - data.clusters.reduce((a, c) => a + c.videos, 0)
  const items: TabItem<TabId>[] = [
    { id: 'clusters', label: 'Clusters', count: t >= T.map ? data.clusters.length : undefined },
    { id: 'briefs', label: 'Dev briefs', count: t >= T.summarise ? data.briefs.filter((b) => statusOf(b) !== 'patched').length + ' open' : undefined },
    { id: 'sources', label: 'Sources', count: t >= T.classify ? data.sources.length : undefined },
    { id: 'profiles', label: 'Profiles', count: t >= T.classify ? data.profiles.length : undefined },
    { id: 'quota', label: 'Quota' },
  ]
  const idPrefix = 'hack-results'

  return (
    <div className="flex flex-col gap-24">
      <RunStage
        sim={sim}
        daemon="hack-daemon"
        title="Exploit map"
        subtitle={`Where ${game.shortName} is being hit, from ${data.sources.length} public videos, ${filtered} of them bait`}
        aside={<RunAside data={data} sim={sim} />}
      >
        <QueryBar data={data} sim={sim} />
        <ExploitMap data={data} sim={sim} gameName={game.shortName} />
        <BriefDeal data={data} sim={sim} statusOf={statusOf} />
      </RunStage>

      <Panel title="Results" description={`Exploit intelligence for the ${game.shortName} team: what is being abused, where, and the server-side fix.`} bodyClassName="px-24 pb-24 pt-16">
        <Tabs items={items} value={tab} onChange={setTab} idPrefix={idPrefix} ariaLabel="Hack Daemon results" />
        <TabPanel idPrefix={idPrefix} id={tab} className="pt-16">
          {tab === 'clusters' && (
            <Gate sim={sim} ready={t >= T.map} sentence={`Run the daemon to map exploit clusters for ${game.shortName}.`}>
              <ClustersTab clusters={data.clusters} moodDrop={moodDrop} />
            </Gate>
          )}
          {tab === 'briefs' && (
            <Gate sim={sim} ready={t >= T.summarise} sentence={`Run the daemon to write dev briefs for ${game.shortName}.`}>
              <BriefsTab clusters={data.clusters} briefs={data.briefs} statusOf={statusOf} onPatched={markPatched} moodDrop={moodDrop} />
            </Gate>
          )}
          {tab === 'sources' && (
            <Gate sim={sim} ready={t >= T.classify} sentence={`Run the daemon to crawl videos about ${game.shortName}.`}>
              <SourcesTab sources={data.sources} clusters={data.clusters} />
            </Gate>
          )}
          {tab === 'profiles' && (
            <Gate sim={sim} ready={t >= T.classify} sentence={`Run the daemon to group the sellers behind ${game.shortName} exploit videos.`}>
              <ProfilesTab profiles={data.profiles} clusters={data.clusters} />
            </Gate>
          )}
          {tab === 'quota' && (
            <Gate sim={sim} ready={t >= T.crawl} sentence="Run the daemon to spend today's YouTube Data API quota.">
              <QuotaTab calls={data.calls} t={t} />
            </Gate>
          )}
        </TabPanel>
      </Panel>
    </div>
  )
}
