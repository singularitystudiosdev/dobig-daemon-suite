import { daemonHref } from '@/lib/router'
import { daemons } from '@/data/daemons'
import { SNAPSHOT_AT } from '@/data/games'
import { fmtDayTime } from '@/lib/format'

/* The dobig.com footer: wordmark left, link columns right, the company line at the bottom. */
export function Footer() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto grid max-w-page gap-32 px-24 py-48 md:grid-cols-4">
        <div className="flex flex-col gap-12">
          <a href="#/" className="flex items-center gap-12 rounded-8">
            <img src="/brand/icon.png" alt="" width={40} height={40} className="size-40 rounded-8" />
            <span className="text-title font-bold text-ink">Do Big</span>
          </a>
          <p className="max-w-prose text-label text-muted">Autonomous growth and protection daemons for live operated Roblox games.</p>
        </div>
        <FooterColumn title="Daemons" links={daemons.map((d) => ({ label: d.name, href: daemonHref(d.slug) }))} />
        <FooterColumn
          title="Studio"
          links={[
            { label: 'Our Games', href: 'https://dobig.com/games' },
            { label: 'Game Acquisition', href: 'https://dobig.com/' },
            { label: 'Careers', href: 'https://dobig.com/careers' },
            { label: 'Bug Bounty', href: 'https://dobig.com/bug-bounty' },
          ]}
        />
        <div className="flex flex-col gap-12">
          <h2 className="text-label font-medium text-ink">Data</h2>
          <p className="text-label text-muted">Game names, player counts and visits are live Roblox values from {fmtDayTime(SNAPSHOT_AT)} UTC. Everything a daemon produces on these pages is simulated demo data.</p>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-page px-24 py-16 text-micro text-subtle">Mobile Game Advertising & More Inc, internal tooling preview. Copyright 2026</p>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div className="flex flex-col gap-12">
      <h2 className="text-label font-medium text-ink">{title}</h2>
      <ul className="flex flex-col gap-8">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-label text-muted transition-colors duration-150 hover:text-ink"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
