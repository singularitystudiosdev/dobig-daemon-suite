import { useState } from 'react'
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react'
import { daemonsBySlug, type DaemonSlug } from '@/data/daemons'
import { toolsBySlug } from '@/data/tools'
import { ExampleRun, ExampleSkeleton } from '@/components/ExampleRun'
import { useExample } from '@/lib/example'
import { markNav } from '@/lib/router'
import { REPO_URL } from '@/lib/static'
import { ToolSwitcher } from '@/demo/shell/ToolSwitcher'

/* #/demo/<slug> in the GitHub Pages build. The real dashboard needs the local server, so this page shows a real,
   read-only example run of the tool (captured once, shipped as public/examples/<slug>.json) and says plainly how to
   run the real thing. If the example file is missing it falls back to the run-it-yourself steps alone. */

const COMMANDS = [`git clone ${REPO_URL}`, 'cd dobig-daemon-suite && npm install', 'npm run dev:keychain']

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1600)
    } catch {
      /* the text is selectable; nothing else to do */
    }
  }
  return (
    <div className="flex items-center justify-between gap-8 rounded-8 border border-line bg-raised py-4 pl-12 pr-4">
      <code className="scroll-thin min-w-0 overflow-x-auto whitespace-nowrap py-4 font-mono text-label text-ink">{text}</code>
      <button type="button" onClick={copy} aria-label={`Copy: ${text}`} className="state-layer inline-flex size-32 shrink-0 items-center justify-center rounded-8 text-muted">
        {done ? <Check aria-hidden className="size-16 text-live" /> : <Copy aria-hidden className="size-16" />}
      </button>
    </div>
  )
}

export default function StaticPreview({ slug }: { slug: DaemonSlug }) {
  const tool = toolsBySlug[slug]
  const Icon = daemonsBySlug[slug].icon
  const { example, loading } = useExample(slug)
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex h-64 max-w-page items-center justify-between gap-12 px-16 sm:px-24">
          <ToolSwitcher slug={slug} />
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="state-layer inline-flex h-40 shrink-0 items-center gap-8 rounded-8 border border-line bg-raised px-16 text-label font-medium text-ink">
            <ExternalLink aria-hidden className="size-16" />
            <span className="hidden sm:inline">Source on GitHub</span>
            <span className="sm:hidden">GitHub</span>
          </a>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-page flex-col gap-32 px-16 py-32 motion-safe:animate-enter sm:px-24 sm:py-48">
        <div className="flex items-start gap-16">
          <span className="inline-flex size-48 shrink-0 items-center justify-center rounded-8 bg-accent-soft text-accent-ink">
            <Icon aria-hidden className="size-24" />
          </span>
          <div className="min-w-0">
            <h1 className="text-headline font-bold text-ink">{tool.name}</h1>
            <p className="mt-4 max-w-prose text-body text-muted">{tool.blurb}</p>
          </div>
        </div>

        {loading ? (
          <ExampleSkeleton />
        ) : example ? (
          <ExampleRun example={example} />
        ) : (
          <p className="max-w-prose text-body text-muted">
            GitHub Pages can only host static files, and every tool calls Roblox, YouTube, Discord or an AI provider through a small local server that holds your keys. So{' '}
            {tool.name} runs on your machine, not on this page.
          </p>
        )}

        <section aria-labelledby="run-title" className="flex max-w-720 flex-col gap-12">
          <h2 id="run-title" className="text-title font-bold text-ink">
            Run it yourself
          </h2>
          <ol className="flex flex-col gap-8" aria-label="Commands">
            {COMMANDS.map((c) => (
              <li key={c}>
                <CopyBlock text={c} />
              </li>
            ))}
          </ol>
          <p className="text-label text-muted">
            The last command reads an OpenRouter key from your macOS keychain. Without one, paste a key into the Keys button in the app, or see the README for the
            other options. Then open http://127.0.0.1:5190.
          </p>
          <div className="mt-12 flex flex-wrap gap-8">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="state-layer inline-flex h-48 items-center justify-center gap-8 whitespace-nowrap rounded-8 bg-accent px-20 text-body font-medium text-ink"
            >
              <ExternalLink aria-hidden className="size-16" />
              Open the repository
            </a>
            <a
              href="#/"
              onClick={() => markNav('back')}
              className="state-layer inline-flex h-48 items-center justify-center gap-8 whitespace-nowrap rounded-8 px-16 text-body font-medium text-muted hover:text-ink"
            >
              <ArrowLeft aria-hidden className="size-20" />
              Back to toolkit
            </a>
          </div>
        </section>
      </main>
    </>
  )
}
