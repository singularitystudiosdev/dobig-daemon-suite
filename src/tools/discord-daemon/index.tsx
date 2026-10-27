import { useMemo, useState } from 'react'
import { CircleAlert, MessagesSquare, Plug, ShieldCheck } from 'lucide-react'
import { fmtCompact, fmtInt, fmtPct, fmtLogTime, easeOut, clamp } from '@/lib/format'
import { useRoute } from '@/lib/router'
import { useSimulation, revealed, type SimStage } from '@/lib/useSimulation'
import { useActiveGame } from '@/context/ActiveGame'
import { games, gamesById, type Game } from '@/data/games'
import { daemonsBySlug } from '@/data/daemons'
import { ToolPage } from '@/components/shell/ToolPage'
import { RunStage } from '@/components/shell/RunStage'
import { Badge, Button, Code, Dialog, Field, LogStream, Panel, Select, StatPill, TabPanel, Tabs, type TabItem } from '@/components/ui'
import { buildDataset, quotesFor } from './data'
import { logFor } from './log'
import { QuoteDialog, RateMeter, SwitchField } from './parts'
import { StageVisual } from './stage'
import { TldrTab } from './tabs/Tldr'
import { TopicsTab } from './tabs/Topics'
import { MoodDropsTab } from './tabs/MoodDrops'
import { DramaTab } from './tabs/Drama'
import { ExcludedTab } from './tabs/Excluded'
import { ReleaseTab } from './tabs/Release'

/* Discord Daemon: connect a server, backfill 7 days, and turn 4,212 messages into 611 people.
   The stage is the one loud element; the result tabs stay quiet and dense behind it. */

const STAGES: SimStage[] = [
  { id: 'connect', label: 'Connect to server', detail: 'Intents and scopes', duration: 2000 },
  { id: 'backfill', label: 'Backfill 7 days', detail: 'Limit 100 pages', duration: 3500 },
  { id: 'people', label: 'Count people', detail: 'Messages to people', duration: 4000 },
  { id: 'cluster', label: 'Topics', detail: 'Six clusters', duration: 4000 },
  { id: 'mood', label: 'Mood timeline', detail: 'Seven days, causes', duration: 3500 },
  { id: 'tldr', label: 'TL;DR', detail: 'Six insights', duration: 2000 },
]

type TabId = 'tldr' | 'topics' | 'mood' | 'drama' | 'excluded' | 'release'
const TAB_IDS: TabId[] = ['tldr', 'topics', 'mood', 'drama', 'excluded', 'release']

interface Connection {
  gameId: string
  messageContent: 'approved' | 'denied'
  revision: number
}

export default function DiscordDaemonPage() {
  const { game, setGameId } = useActiveGame()
  const [connection, setConnection] = useState<Connection>({ gameId: game.id, messageContent: 'approved', revision: 0 })
  const [connectOpen, setConnectOpen] = useState(false)
  const [targetGameId, setTargetGameId] = useState(game.id)
  const [denied, setDenied] = useState(false)
  const active: Connection = connection.gameId === game.id ? connection : { gameId: game.id, messageContent: 'approved', revision: 0 }

  const openConnect = () => {
    setTargetGameId(game.id)
    setDenied(active.messageContent === 'denied')
    setConnectOpen(true)
  }

  return (
    <ToolPage
      daemon={daemonsBySlug['discord-daemon']}
      actions={
        <Button variant="primary" icon={Plug} onClick={openConnect}>
          Connect a server
        </Button>
      }
    >
      <RunBody
        key={`${game.id}-${active.messageContent}-${active.revision}`}
        game={game}
        messageContent={active.messageContent}
        onOpenConnect={openConnect}
      />

      <Dialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        title="Connect a server"
        description="Pick one of your community servers. The daemon reads a 7-day window of public channels and counts people, not messages."
        className="w-640"
        footer={
          <>
            <Button onClick={() => setConnectOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              icon={Plug}
              onClick={() => {
                const next = gamesById[targetGameId] ?? game
                setGameId(next.id)
                setConnection({ gameId: next.id, messageContent: denied ? 'denied' : 'approved', revision: active.revision + 1 })
                setConnectOpen(false)
              }}
            >
              Connect server
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-16">
          <Field label="Server" hint="Only the 12 Do Big community servers are wired to this demo. Any other invite needs the bot installed by an admin.">
            {(id) => (
              <Select id={id} value={targetGameId} onChange={(e) => setTargetGameId(e.target.value)}>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.shortName} Community
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="rounded-8 border border-line bg-sunken px-12 py-8">
            <div className="flex items-center justify-between gap-8">
              <h3 className="flex items-center gap-8 text-label font-medium text-ink">
                <ShieldCheck aria-hidden className="size-14 text-live" />
                Bot invite
              </h3>
              <span className="font-mono text-micro text-subtle">intents=33281</span>
            </div>
            <p className="mt-8 break-all font-mono text-micro text-ink">
              discord.com/oauth2/authorize?client_id=1248003125000000001&scope=bot+applications.commands&permissions=66560
            </p>
            <ul className="mt-8 flex flex-wrap gap-8">
              <li><Badge tone="accent">scope bot</Badge></li>
              <li><Badge tone="accent">scope applications.commands</Badge></li>
              <li><Badge tone="muted">permissions 66560</Badge></li>
            </ul>
            <ul className="mt-12 flex flex-col gap-6">
              <li className="flex items-center justify-between gap-8 text-micro">
                <span className="flex items-center gap-8 text-ink">
                  <Code>1&lt;&lt;9</Code> GUILD_MESSAGES
                </span>
                <Badge tone="live">granted</Badge>
              </li>
              <li className="flex items-center justify-between gap-8 text-micro">
                <span className="flex items-center gap-8 text-ink">
                  <Code>1&lt;&lt;15</Code> MESSAGE_CONTENT
                </span>
                {denied ? <Badge tone="warn">not approved, 4014</Badge> : <Badge tone="live">approved, privileged</Badge>}
              </li>
              <li className="flex items-center justify-between gap-8 text-micro">
                <span className="flex items-center gap-8 text-ink">
                  <Code>1&lt;&lt;16</Code> READ_MESSAGE_HISTORY
                </span>
                <Badge tone="live">granted</Badge>
              </li>
            </ul>
          </div>

          <SwitchField
            checked={denied}
            onChange={setDenied}
            label="MESSAGE_CONTENT not approved (4014)"
            description="Request the intent as pending. The run falls back to metadata analytics, and every sentiment read is replaced by a labelled metadata read."
          />

          {denied && (
            <div className="flex items-start gap-12 rounded-8 border border-warn bg-warn-soft px-12 py-8">
              <CircleAlert aria-hidden className="mt-2 size-16 shrink-0 text-warn" />
              <p className="text-label text-ink">
                MESSAGE_CONTENT not approved: content arrives empty; only metadata analytics are available.
                <span className="mt-4 block text-micro text-muted">Discord returns 4014 on the gateway. The daemon handles it instead of failing the run, and the results keep every count that metadata supports.</span>
              </p>
            </div>
          )}

          <div className="flex items-center gap-8 border-t border-line pt-12 text-micro text-muted">
            <MessagesSquare aria-hidden className="size-14 shrink-0" />
            The connected game follows the server, so the run, the audience numbers and the event bus all switch together.
          </div>
        </div>
      </Dialog>
    </ToolPage>
  )
}

function RunBody({ game, messageContent, onOpenConnect }: { game: Game; messageContent: 'approved' | 'denied'; onOpenConnect: () => void }) {
  const dataset = useMemo(() => buildDataset(game, messageContent), [game, messageContent])
  const sim = useSimulation(STAGES, { autoStartDelay: 700 })
  const route = useRoute()
  const focus = route.query.get('focus')
  const initialTab: TabId = focus && (TAB_IDS as string[]).includes(focus) ? (focus as TabId) : 'tldr'
  const [tab, setTab] = useState<TabId>(initialTab)
  const [quoteState, setQuoteState] = useState<{ open: boolean; topicId: string | null; title: string; total: number }>({ open: false, topicId: null, title: '', total: 0 })

  const openQuotes = (topicId: string | null, title: string, total: number) => setQuoteState({ open: true, topicId, title, total })
  const logLines = useMemo(() => logFor(dataset), [dataset])
  const visible = useMemo(
    () =>
      revealed(logLines, sim).map((line) => ({
        id: line.id,
        ts: fmtLogTime(line.at),
        level: line.level,
        text: line.text,
      })),
    [logLines, sim],
  )

  const scanned = Math.round(dataset.window.messages * easeOut(sim.within('backfill')))
  const counted = Math.round(dataset.window.people * easeOut(sim.within('people')))
  const negative = dataset.window.negativeMessageShare + (dataset.window.negativePeopleShare - dataset.window.negativeMessageShare) * clamp((sim.within('people') - 0.38) / 0.34)
  const pages = Math.round(43 * easeOut(sim.within('backfill')))
  const hasBackfill = sim.within('backfill') >= 1
  const hasPeople = sim.within('people') > 0.02
  const reqPerSec = sim.status === 'idle' ? 0 : Math.round(8 + 30 * Math.abs(Math.sin((sim.t % 2400) / 2400 * Math.PI)))
  const tabs: TabItem<TabId>[] = [
    { id: 'tldr', label: 'TL;DR', count: dataset.insights.length },
    { id: 'topics', label: 'Topics', count: dataset.topics.length },
    { id: 'mood', label: 'Mood drops', count: dataset.mood.drops.length },
    { id: 'drama', label: 'Drama alerts', count: dataset.drama.checks.filter((c) => c.verdict === 'alert').length },
    { id: 'excluded', label: 'Excluded', count: dataset.exclusions.length },
    { id: 'release', label: 'Release report' },
  ]
  const intro = dataset.metadataOnly
    ? `${dataset.server.name}, metadata only. MESSAGE_CONTENT is not approved, so counts and channels are live and sentiment is labelled unavailable.`
    : `${dataset.server.name}. ${fmtCompact(dataset.server.members)} members, ${fmtInt(dataset.window.messages)} messages weighed down to ${fmtInt(dataset.window.people)} people.`

  return (
    <>
      <RunStage
        sim={sim}
        daemon="discord-daemon"
        title="Live run"
        subtitle={intro}
        aside={
          <div className="flex min-w-0 flex-col gap-16">
            <div className="grid grid-cols-2 gap-8">
              <StatPill label="Messages" value={hasBackfill ? fmtInt(scanned) : fmtInt(scanned)} />
              <StatPill label="People" value={hasPeople ? fmtInt(counted) : 'n/a'} />
              <StatPill label="Negative" value={dataset.metadataOnly ? 'n/a' : hasBackfill ? fmtPct(negative, 0) : 'n/a'} tone={dataset.metadataOnly || !hasBackfill ? 'muted' : 'warn'} />
              <StatPill label="Pages" value={`${pages} / 43`} />
            </div>
            <RateMeter reqPerSec={reqPerSec} />
            <LogStream lines={visible} title="Discord API and analysis" heightClass="h-260" />
          </div>
        }
      >
        <StageVisual sim={sim} dataset={dataset} onOpenQuotes={openQuotes} />
      </RunStage>

      <Panel
        title="Results"
        description={dataset.metadataOnly ? 'Metadata read. The connect dialog can approve MESSAGE_CONTENT and re-run this server.' : 'Counted per person. Every insight links back to the messages that produced it.'}
        actions={
          <>
            <Badge tone={dataset.metadataOnly ? 'warn' : 'muted'} dot pulse={false}>
              {dataset.metadataOnly ? '4014, metadata only' : 'Oct 19 to Oct 26'}
            </Badge>
            <Badge tone={sim.status === 'done' ? 'live' : 'accent'} dot pulse={sim.status === 'running'}>
              {sim.status === 'done' ? 'Run complete' : sim.status === 'idle' ? 'Ready' : 'Analysis running'}
            </Badge>
          </>
        }
      >
        <Tabs items={tabs} value={tab} onChange={setTab} idPrefix="discord" ariaLabel="Discord Daemon results" />
        <div className="mt-16">
          {tab === 'tldr' && (
            <TabPanel idPrefix="discord" id="tldr">
              <TldrTab dataset={dataset} onOpenQuotes={openQuotes} />
            </TabPanel>
          )}
          {tab === 'topics' && (
            <TabPanel idPrefix="discord" id="topics">
              <TopicsTab dataset={dataset} onOpenQuotes={openQuotes} />
            </TabPanel>
          )}
          {tab === 'mood' && (
            <TabPanel idPrefix="discord" id="mood">
              <MoodDropsTab dataset={dataset} game={game} onOpenQuotes={openQuotes} onOpenConnect={onOpenConnect} />
            </TabPanel>
          )}
          {tab === 'drama' && (
            <TabPanel idPrefix="discord" id="drama">
              <DramaTab dataset={dataset} onRecheck={sim.start} />
            </TabPanel>
          )}
          {tab === 'excluded' && (
            <TabPanel idPrefix="discord" id="excluded">
              <ExcludedTab dataset={dataset} />
            </TabPanel>
          )}
          {tab === 'release' && (
            <TabPanel idPrefix="discord" id="release">
              <ReleaseTab dataset={dataset} onOpenQuotes={openQuotes} />
            </TabPanel>
          )}
        </div>
      </Panel>

      <QuoteDialog
        open={quoteState.open}
        onOpenChange={(open) => setQuoteState((s) => ({ ...s, open }))}
        title={quoteState.title || 'Linked messages'}
        quotes={quotesFor(dataset, quoteState.topicId, 24)}
        total={quoteState.total}
        metadataOnly={dataset.metadataOnly}
      />
    </>
  )
}
