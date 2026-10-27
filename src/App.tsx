import { Suspense } from 'react'
import { useRoute } from '@/lib/router'
import { isDaemonSlug } from '@/data/daemons'
import { toolPages } from '@/tools/registry'
import { ActiveGameProvider } from '@/context/ActiveGame'
import { TopNav } from '@/components/shell/TopNav'
import { Footer } from '@/components/shell/Footer'
import { Skeleton, ToastProvider } from '@/components/ui'
import Hub from '@/pages/Hub'

export default function App() {
  const { segments } = useRoute()
  const slug = segments[0] === 'd' && isDaemonSlug(segments[1]) ? segments[1] : null
  const Page = slug ? toolPages[slug] : null
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
        <TopNav active={slug ?? 'hub'} />
        <Suspense fallback={<PageFallback />}>{Page ? <Page key={slug} /> : <Hub />}</Suspense>
        <Footer />
      </ToastProvider>
    </ActiveGameProvider>
  )
}

function PageFallback() {
  return (
    <div className="mx-auto flex max-w-page flex-col gap-24 px-24 pb-96 pt-24" aria-busy>
      <Skeleton className="h-20 w-160" />
      <div className="flex items-center gap-20">
        <Skeleton className="size-96" />
        <div className="flex flex-1 flex-col gap-12">
          <Skeleton className="h-40 w-1/3" />
          <Skeleton className="h-16 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-480 w-full" />
    </div>
  )
}
