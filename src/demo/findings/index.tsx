import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, ExternalLink, Play } from 'lucide-react'
import { Button, EmptyState, Panel, SkeletonRows, useToast } from '@/components/ui'
import { toolsBySlug } from '@/data/tools'
import { runDaemonNow } from '@/lib/api'
import type { RunFailure } from './runState'
import type { WorkspaceProps } from '../types'
import { FindingsList } from './FindingsList'
import { isEnded, statusFor, useRun } from './runState'
import { ThinkingPanel } from './Thinking'

/* One workspace for the five findings tools: a live view of a server run. It follows props.runId, folds the run's
   events into steps, a summary and findings, and renders them as they arrive. Nothing here is generated on the client. */

const linkButton =
  'state-layer inline-flex h-32 shrink-0 select-none items-center justify-center gap-6 whitespace-nowrap rounded-8 border border-line bg-raised px-12 text-label font-medium text-ink'

export function FindingsWorkspace(props: WorkspaceProps) {
  const { slug, daemon, runId, report, onChanged } = props
  const tool = toolsBySlug[slug]
  const { state, reconnect } = useRun(runId)
  const toast = useToast()
  const [starting, setStarting] = useState(false)

  // Report in the rail from real state only.
  const reportRef = useRef(report)
  reportRef.current = report
  const status = statusFor(state)
  useEffect(() => {
    reportRef.current({ label: status.label, tone: status.tone, progress: status.progress })
  }, [status.label, status.tone, status.progress])

  // Credits and the daemon's last run changed when a run ends.
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const ended = state.end !== null || state.error !== null
  useEffect(() => {
    if (ended) onChangedRef.current()
  }, [ended, runId])

  const runAgain = useCallback(async () => {
    setStarting(true)
    try {
      await runDaemonNow(daemon.id)
      onChangedRef.current()
    } catch (err) {
      toast.push({ title: 'Could not start the run', description: err instanceof Error ? err.message : 'Try again in a moment.', tone: 'danger' })
    } finally {
      setStarting(false)
    }
  }, [daemon.id, toast])

  if (!runId) {
    return (
      <Panel>
        <EmptyState icon={Play} sentence={`${tool.name} has not run on this target yet.`} actionLabel={starting ? 'Starting' : 'Run now'} onAction={() => void runAgain()} />
      </Panel>
    )
  }

  const running = !isEnded(state)
  return (
    <div className="flex flex-col gap-16">
      <ThinkingPanel name={tool.name} state={state} />
      {state.error && (
        <RunErrorPanel
          error={state.error}
          starting={starting}
          openKeyDialog={props.openKeyDialog}
          openDiscordToken={props.openDiscordToken}
          addCredits={() => {
            window.scrollTo({ top: 0 })
            toast.push({ title: 'Add credits from the top bar', description: 'Then run it again.', tone: 'info' })
            onChanged()
          }}
          creditsHref={`#/demo/${slug}`}
          runAgain={() => void runAgain()}
          reconnect={reconnect}
        />
      )}
      {state.findings.length > 0 || state.end?.status === 'done' ? (
        <FindingsList
          title={tool.resultsTitle}
          findings={state.findings}
          summary={state.summary}
          running={running}
          tool={slug}
          daemonId={daemon.id}
          onEmpty={{ label: starting ? 'Starting' : 'Run again', run: () => void runAgain() }}
        />
      ) : (
        !state.error && (
          <Panel bodyClassName="px-24 py-8">
            <SkeletonRows rows={3} />
          </Panel>
        )
      )}
    </div>
  )
}

function RunErrorPanel({
  error,
  starting,
  openKeyDialog,
  openDiscordToken,
  addCredits,
  creditsHref,
  runAgain,
  reconnect,
}: {
  error: RunFailure
  starting: boolean
  openKeyDialog: () => void
  openDiscordToken: () => void
  addCredits: () => void
  creditsHref: string
  runAgain: () => void
  reconnect: () => void
}) {
  const action = error.action
  let control: ReactNode = null
  if (error.code === 'connection') {
    control = (
      <Button size="sm" onClick={reconnect}>
        Reconnect
      </Button>
    )
  } else if (action) {
    switch (action.kind) {
      case 'add-key':
        control = (
          <Button size="sm" variant="primary" onClick={openKeyDialog}>
            {action.label}
          </Button>
        )
        break
      case 'add-discord-token':
        control = (
          <Button size="sm" variant="primary" onClick={openDiscordToken}>
            {action.label}
          </Button>
        )
        break
      case 'open-url':
        control = action.url ? (
          <a href={action.url} target="_blank" rel="noreferrer" className={linkButton}>
            {action.label}
            <ExternalLink aria-hidden className="size-16" />
          </a>
        ) : null
        break
      case 'add-credits':
        control = (
          <a href={creditsHref} onClick={addCredits} className={linkButton}>
            {action.label}
          </a>
        )
        break
      case 'retry':
        control = (
          <Button size="sm" loading={starting} onClick={runAgain}>
            Run again
          </Button>
        )
        break
    }
  } else {
    control = (
      <Button size="sm" loading={starting} onClick={runAgain}>
        Run again
      </Button>
    )
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-16 gap-y-12 rounded-20 border border-line bg-surface px-24 py-16">
      <CircleAlert aria-hidden className="size-20 shrink-0 text-warn" />
      <p className="min-w-0 max-w-prose flex-1 basis-240 text-label text-ink">{error.message}</p>
      {control}
    </div>
  )
}
