/* The GitHub Pages build (VITE_STATIC_PREVIEW=1) has no server: Pages serves static files, and every tool depends on
   the local API in server/** (Roblox, YouTube, Discord, an AI provider, your keys, your saved daemons). In that build
   the interface is fully browsable and each tool's dashboard explains how to run the real thing. Nothing is faked:
   no request ever leaves the page for /api, and nothing pretends to have run. */

const env = import.meta.env as Record<string, string | undefined> | undefined

/** True only in the Pages build. */
export const STATIC_PREVIEW = env?.VITE_STATIC_PREVIEW === '1'

export const REPO_URL = 'https://github.com/singularitystudiosdev/dobig-daemon-suite'

/** Prefixes a public/ path with the deploy base (`/` in dev, `/<repo>/` on project Pages). Safe in Node, where there is no import.meta.env. */
export function asset(path: string): string {
  const base = env?.BASE_URL ?? '/'
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}

export const NO_BACKEND_MESSAGE = 'This GitHub Pages preview has no server, so nothing can run here. Run the app on your machine to use the tools.'

/** In the Pages build, answers every /api request itself with a plain 503, so no component has to know there is no server. */
export function installNoBackend(): void {
  if (!STATIC_PREVIEW || typeof window === 'undefined') return
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(raw, window.location.href).pathname
    if (path.startsWith('/api/')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, code: 'no-backend', message: NO_BACKEND_MESSAGE }), { status: 503, headers: { 'content-type': 'application/json' } }))
    }
    return real(input, init)
  }
}
