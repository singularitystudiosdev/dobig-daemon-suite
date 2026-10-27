/* The dobig.com navbar, simplified: black, sticky, logo and wordmark on the left that link home.
   The old full-run pages add one compact link back to the toolkit on the right. */
export function TopNav({ showToolkitLink = false }: { showToolkitLink?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas">
      <div className="mx-auto flex h-80 max-w-page items-center justify-between gap-24 px-24">
        <a href="#/" className="flex min-w-0 items-center gap-12 rounded-8" aria-label="Roblox Daemon Toolkit home">
          <img src="/brand/icon.png" alt="" width={44} height={44} className="size-44 shrink-0 rounded-8" />
          <span className="truncate text-title font-bold text-ink">Roblox Daemon Toolkit</span>
        </a>
        {showToolkitLink && (
          <nav aria-label="Main navigation">
            <a href="#/" className="state-layer block whitespace-nowrap rounded-8 px-12 py-8 text-label font-medium text-muted transition-colors duration-150 hover:text-ink">
              Toolkit
            </a>
          </nav>
        )}
      </div>
    </header>
  )
}
