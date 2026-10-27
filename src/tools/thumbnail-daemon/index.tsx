/* Thumbnail Daemon page: the impression river run stage, the live Open Cloud counters and the
   five results tabs. RunBody is keyed by game.id so switching the active game restarts the run
   with that game's derived records. */

import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { busFor } from '@/data/bus'
import { daemonsBySlug } from '@/data/daemons'
import type { Game } from '@/data/games'
import { useActiveGame } from '@/context/ActiveGame'
import { fmtCompact, fmtLogTime, fmtPct } from '@/lib/format'
import { useRoute } from '@/lib/router'
import { revealed, useSimulation } from '@/lib/useSimulation'
import { Badge, LogStream, StatPill, type LogLine } from '@/components/ui'
import { RunStage } from '@/components/shell/RunStage'
import { ToolPage } from '@/components/shell/ToolPage'
import { StageRiver, UploadSlots } from './StageRiver'
import { Results, tabFromFocus, type TabId } from './tabs'
import { LOG_LINES, STAGES, buildDataset, leaderAt, logText, moderationAt, servedAt, shareAt } from './data'

export default function Page() {
  const daemon = daemonsBySlug['thumbnail-daemon']
  const { game } = useActiveGame()
  return (
    <ToolPage
      daemon={daemon}
      actions={
        <>
          <Badge tone="warn">Experimental API</Badge>
          <Badge tone="muted" className="font-mono">
            universe {game.universeId}
          </Badge>
        </>
      }
    >
      <RunBody key={game.id} game={game} />
    </ToolPage>
  )
}

function HoldNotice({ game }: { game: Game }) {
  const hold = busFor(game).find((event) => event.kind === 'description-hold')
  if (!hold) return null
  return (
    <div className="flex flex-wrap items-start gap-12 rounded-20 border border-line bg-warn-soft px-16 py-12">
      <Info aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p className="text-label text-ink">Description Daemon is holding this universe until Oct 26, so new thumbnail tests wait.</p>
        <p className="mt-2 text-micro text-muted">{hold.detail}</p>
      </div>
      <a href="#/d/description-daemon" className="state-layer shrink-0 rounded-8 border border-line px-12 py-8 text-micro font-medium text-ink">
        Open Description Daemon
      </a>
    </div>
  )
}

function RunBody({ game }: { game: Game }) {
  const sim = useSimulation(STAGES)
  const dataset = useMemo(() => buildDataset(game), [game])
  const route = useRoute()
  const [tab, setTab] = useState<TabId>(() => tabFromFocus(route.query.get('focus')))

  const logLines: LogLine[] = revealed(LOG_LINES, sim).map((line) => ({
    id: line.id,
    ts: fmtLogTime(line.at),
    level: line.level,
    text: logText(line, dataset),
  }))

  const served = servedAt(sim, dataset.variants)
  const leader = leaderAt(sim, dataset.variants)
  const active = dataset.variants.filter((v) => moderationAt(sim, v) !== 'Rejected').length
  const leaderShare = sim.reached('explore') ? shareAt(sim, leader) : 0.25

  return (
    <>
      <HoldNotice game={game} />
      <UploadSlots sim={sim} dataset={dataset} />
      <RunStage
        sim={sim}
        daemon="thumbnail-daemon"
        title="Impression river"
        subtitle={`A contextual bandit over four creatives on ${game.shortName}. Explore at an even split, then move Home impressions to the winner per segment.`}
        aside={
          <div className="flex flex-col gap-12">
            <div className="grid grid-cols-2 gap-8">
              <StatPill label="Impressions" value={fmtCompact(served)} />
              <StatPill label="Arms serving" value={`${active} of 4`} />
              <StatPill label="Leader" value={sim.reached('exploit') ? `${leader.id} ${fmtPct(leaderShare, 0)}` : 'Even split'} />
              <StatPill label="Share floor" value="5%" />
            </div>
            <div className="rounded-8 border border-line bg-raised px-12 py-8">
              <p className="font-mono text-micro text-ink">Write 7/50 per min</p>
              <p className="font-mono text-micro text-muted">Read 92/100 per min</p>
            </div>
            <LogStream lines={logLines} title="Open Cloud log" heightClass="h-240" />
            <p className="text-micro text-subtle">
              Novelty effect: the first 72 hours overstate the lift, so early QPTR usually decays.
            </p>
          </div>
        }
      >
        <StageRiver sim={sim} dataset={dataset} />
      </RunStage>
      <Results sim={sim} dataset={dataset} tab={tab} onTabChange={setTab} />
    </>
  )
}
