import { asset } from '@/lib/static'

/* The dobig.com footer, reduced: logo and one line on the left, the Studio links on the right,
   the company line at the bottom. */
const studioLinks = [
  { label: 'Our Games', href: 'https://dobig.com/games' },
  { label: 'Game Acquisition', href: 'https://dobig.com/' },
  { label: 'Careers', href: 'https://dobig.com/careers' },
  { label: 'Bug Bounty', href: 'https://dobig.com/bug-bounty' },
]

export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-page flex-col gap-32 px-24 py-48 md:flex-row md:justify-between">
        <div className="flex flex-col gap-12">
          <a href="#/" className="flex items-center gap-12 rounded-8">
            <img src={asset('/brand/icon.png')} alt="" width={40} height={40} className="size-40 rounded-8" />
            <span className="text-title font-bold text-ink">Roblox Daemon Toolkit</span>
          </a>
          <p className="max-w-prose text-label text-muted">Autonomous growth and protection tools for live operated Roblox games.</p>
        </div>
        <nav aria-label="Studio" className="flex flex-col gap-12">
          <h2 className="text-label font-medium text-ink">Studio</h2>
          <ul className="flex flex-col gap-8">
            {studioLinks.map((l) => (
              <li key={l.label}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-label text-muted transition-colors duration-150 hover:text-ink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-page px-24 py-16 text-micro text-subtle">Mobile Game Advertising & More Inc, internal tooling preview. Copyright 2026</p>
      </div>
    </footer>
  )
}
