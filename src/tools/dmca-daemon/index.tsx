import { useEffect, useMemo, useState } from 'react'
import { daemonsBySlug } from '@/data/daemons'
import type { Game } from '@/data/games'
import { useActiveGame } from '@/context/ActiveGame'
import { useReducedMotion } from '@/lib/hooks'
import { useRoute } from '@/lib/router'
import { useSimulation } from '@/lib/useSimulation'
import { ToolPage } from '@/components/shell/ToolPage'
import { RunStage } from '@/components/shell/RunStage'
import { Panel, TabPanel, Tabs, type TabItem } from '@/components/ui'
import { Aside } from './Aside'
import { Stage } from './Stage'
import { STAGES, TOTALS, buildDataset } from './data'
import { AttestationTab } from './tabs/AttestationTab'
import { AutoFileTab } from './tabs/AutoFileTab'
import { FamiliesTab } from './tabs/FamiliesTab'
import { FunnelTab } from './tabs/FunnelTab'
import { ClaimsTab, RequestsTab } from './tabs/RequestsTab'
import { ReviewTab, type Decision } from './tabs/ReviewTab'

type TabId = 'funnel' | 'auto-file' | 'review' | 'requests' | 'claims' | 'attestation' | 'families'
const TAB_IDS: TabId[] = ['funnel', 'auto-file', 'review', 'requests', 'claims', 'attestation', 'families']

export default function Page() {
  const { game } = useActiveGame()
  return (
    <ToolPage daemon={daemonsBySlug['dmca-daemon']}>
      <Body key={game.id} game={game} />
    </ToolPage>
  )
}

function Body({ game }: { game: Game }) {
  const sim = useSimulation(STAGES)
  const reduced = useReducedMotion()
  const data = useMemo(() => buildDataset(game), [game])
  const { query } = useRoute()
  const focus = query.get('focus')
  const [tab, setTab] = useState<TabId>(() => (TAB_IDS.includes(focus as TabId) ? (focus as TabId) : 'funnel'))
  useEffect(() => {
    if (focus && TAB_IDS.includes(focus as TabId)) setTab(focus as TabId)
  }, [focus])

  const [userDecisions, setUserDecisions] = useState<Record<string, Decision>>({})
  const [revoked, setRevoked] = useState(false)

  /* The run decides two approvals and one dismissal during the Review stage; the user's own
     clicks override. */
  const decisions = useMemo(() => {
    const out: Record<string, Decision> = {}
    const rp = sim.status === 'done' ? 1 : sim.within('review')
    data.runDecisions.forEach((d, i) => {
      if (rp >= 0.3 + i * 0.24)
        out[d.id] = { decision: d.decision, reviewer: d.reviewer, note: d.decision === 'dismissed' ? 'Licensed from Creator Store, false positive' : `Added to ${data.requestR}` }
    })
    return { ...out, ...userDecisions }
  }, [sim, data, userDecisions])

  const pendingReview = TOTALS.review - Object.keys(decisions).length
  const items: TabItem<TabId>[] = [
    { id: 'funnel', label: 'Funnel' },
    { id: 'auto-file', label: 'Auto-file', count: TOTALS.auto },
    { id: 'review', label: 'Review queue', count: Math.max(0, pendingReview) },
    { id: 'requests', label: 'Removal Requests' },
    { id: 'claims', label: 'Claims Against Me', count: 1 },
    { id: 'attestation', label: 'Attestation' },
    { id: 'families', label: 'IP families', count: data.families.length },
  ]
  const idPrefix = 'dmca'

  return (
    <>
      <RunStage
        sim={sim}
        daemon="dmca-daemon"
        title="Two-lane sorter"
        subtitle={`${game.shortName}: exact copies auto-file through Rights Manager, lookalikes wait for a person`}
        aside={<Aside sim={sim} data={data} />}
      >
        <Stage sim={sim} data={data} game={game} reduced={reduced} />
      </RunStage>
      <Panel title="Results" description={`Takedown results for ${game.shortName}, universe ${game.universeId}.`}>
        <Tabs items={items} value={tab} onChange={setTab} idPrefix={idPrefix} ariaLabel="DMCA Daemon results" />
        <TabPanel idPrefix={idPrefix} id={tab} className="pt-24">
          {tab === 'funnel' && <FunnelTab data={data} />}
          {tab === 'auto-file' && <AutoFileTab sim={sim} data={data} game={game} />}
          {tab === 'review' && <ReviewTab sim={sim} data={data} game={game} decisions={decisions} onDecide={(id, d) => setUserDecisions((m) => ({ ...m, [id]: d }))} />}
          {tab === 'requests' && <RequestsTab sim={sim} data={data} />}
          {tab === 'claims' && <ClaimsTab data={data} />}
          {tab === 'attestation' && <AttestationTab data={data} revoked={revoked} onRevokedChange={setRevoked} />}
          {tab === 'families' && <FamiliesTab data={data} />}
        </TabPanel>
      </Panel>
    </>
  )
}
