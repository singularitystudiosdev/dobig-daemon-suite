import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkeletonRows, Panel } from '@/components/ui'
import { toolsBySlug } from '@/data/tools'
import type { Tone } from '@/lib/tone'
import type { WorkspaceProps } from '../types'
import { modelFor } from './adapters'
import { FindingDetailView } from './Details'
import { FindingsList } from './FindingsList'
import { ThinkingPanel, useThinking } from './Thinking'
import type { StateMap } from './types'

/* One workspace for five tools: a visible thinking phase, then the ordered findings landing row by row.
   The run starts on mount and all state stays here, so the shell can keep this mounted while hidden. */

export function FindingsWorkspace({ slug, entry, report }: WorkspaceProps) {
  const tool = toolsBySlug[slug]
  const model = useMemo(() => modelFor(slug, entry.info), [slug, entry.info])
  const thinking = useThinking(tool.thinking.length, entry.id)
  const [states, setStates] = useState<StateMap>({})

  const reportRef = useRef(report)
  reportRef.current = report

  // Report progress in 5% steps so the rail does not re-render on every tick.
  const bucket = Math.round(thinking.progress * 20) / 20
  const count = model?.findings.length ?? 0
  const topTone: Tone = model?.findings[0]?.badge.tone ?? 'muted'
  useEffect(() => {
    if (!model) return
    if (thinking.done) reportRef.current({ label: `${count} findings`, tone: topTone })
    else reportRef.current({ label: 'Thinking', tone: 'accent', progress: bucket })
  }, [model, thinking.done, bucket, count, topTone])

  const setState = useCallback((id: string, state: string | undefined) => {
    setStates((prev) => {
      const next = { ...prev }
      if (state === undefined) delete next[id]
      else next[id] = state
      return next
    })
  }, [])

  if (!model) return <p className="text-label text-muted">{tool.name} has its own workspace.</p>

  return (
    <div className="flex flex-col gap-16">
      <ThinkingPanel name={tool.name} steps={tool.thinking} details={model.steps} state={thinking} findingCount={count} />
      {thinking.done ? (
        <FindingsList
          title={tool.resultsTitle}
          model={model}
          states={states}
          summary={model.summary?.(states)}
          renderDetail={(finding, state) => <FindingDetailView finding={finding} state={state} setState={setState} />}
        />
      ) : (
        <Panel bodyClassName="px-24 py-8">
          <SkeletonRows rows={Math.min(5, Math.max(3, count))} />
        </Panel>
      )}
    </div>
  )
}
