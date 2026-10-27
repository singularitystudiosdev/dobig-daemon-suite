import { lazy, Suspense, type ReactNode } from 'react'
import { useRoute } from '@/lib/router'
import { isDaemonSlug } from '@/data/daemons'
import { toolPages } from '@/tools/registry'
import { ActiveGameProvider } from '@/context/ActiveGame'
import { TopNav } from '@/components/shell/TopNav'
import { Footer } from '@/components/shell/Footer'
import { Skeleton, ToastProvider } from '@/components/ui'
import Hub from '@/pages/Hub'
import ToolDetail from '@/pages/ToolDetail'

const Demo = lazy(() => import('@/pages/Demo'))

/* Routes: #/ the hub, #/t/<slug> a tool's detail, #/demo/<slug> its demo dashboard (its own top bar,
   so no navbar or footer), #/d/<slug> the full simulated run. Anything else is the hub. */
export default function App() {
  const { segments } = useRoute()
  const [area, second = ''] = segments
  const validSlug = isDaemonSlug(second) ? second : null

  let page: ReactNode = <Hub />
  if (area === 't') page = <ToolDetail key={second} slug={second} />
  else if (area === 'demo' && validSlug) page = <Demo key={validSlug} slug={validSlug} />
  else if (area === 'd' && validSlug) {
    const Page = toolPages[validSlug]
    page = <Page key={validSlug} />
  }
  const isDemo = area === 'demo' && validSlug !== null
  const isRun = area === 'd' && validSlug !== null

  return (
    <ActiveGameProvider>
      <ToastProvider>
        <button
          type="button"
          onClick={() => document.getElementById('main-content')?.focus()}
          className="sr-only rounded-8 bg-accent px-16 py-8 text-label text-ink focus:not-sr-only focus:fixed focus:left-16 focus:top-16 focus:z-50"
        >
          Skip to main content
        </button>
        {!isDemo && <TopNav showToolkitLink={isRun} />}
        <Suspense fallback={<PageFallback />}>{page}</Suspense>
        {!isDemo && <Footer />}
      </ToastProvider>
    </ActiveGameProvider>
  )
}

function PageFallback() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-page px-24 pt-48">
      <Skeleton className="h-48 w-320" />
      <Skeleton className="mt-24 h-320 w-full" />
    </main>
  )
}
