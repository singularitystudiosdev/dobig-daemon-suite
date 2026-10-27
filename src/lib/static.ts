/* The GitHub Pages build (VITE_STATIC_PREVIEW=1) has no server: Pages serves static files, and every tool depends on
   the local API in server/** (Roblox, YouTube, Discord, an AI provider, your keys, your saved daemons). In that build
   the interface is fully browsable and each tool's dashboard explains how to run the real thing. Nothing is faked:
   no request ever leaves the page for /api, and nothing pretends to have run. */

const env = import.meta.env as Record<string, string | undefined> | undefined

/** The hosted server's origin (VITE_API_BASE), without a trailing slash. Empty means the API is on this origin (dev, preview, or a local copy) or, in the Pages build, absent. */
export const API_BASE = (env?.VITE_API_BASE ?? '').replace(/\/+$/, '')

/** True only in the Pages build without a hosted server. A Pages build with VITE_API_BASE runs the real tools. */
export const STATIC_PREVIEW = env?.VITE_STATIC_PREVIEW === '1' && !API_BASE

export const REPO_URL = 'https://github.com/singularitystudiosdev/dobig-daemon-suite'

/** Prefixes a public/ path with the deploy base (`/` in dev, `/<repo>/` on project Pages). Safe in Node, where there is no import.meta.env. */
export function asset(path: string): string {
  const base = env?.BASE_URL ?? '/'
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}

export const NO_BACKEND_MESSAGE = 'This GitHub Pages preview has no server, so nothing can run here. Run the app on your machine to use the tools.'

/** localStorage key holding the access code of a private hosted server. */
export const ACCESS_KEY = 'dobig.access'
/** Fired on window when the hosted server answers 401 with code 'access'. */
export const ACCESS_EVENT = 'dobig:access-needed'

/** The browser's own fetch, taken before the shim below replaces it. */
const nativeFetch: typeof fetch | null = typeof window === 'undefined' ? null : window.fetch.bind(window)

function storedCode(): string {
  try {
    return window.localStorage.getItem(ACCESS_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Points a relative `/api/...` URL at the hosted server. Other URLs are returned unchanged. Use it for a URL that is
 *  not fetched, such as an <img src>. */
export function apiUrl(url: string): string {
  return API_BASE && url.startsWith('/api/') ? `${API_BASE}${url}` : url
}

/** Asks the hosted server whether `code` is accepted. 'unreachable' means the server did not answer at all. */
export async function checkAccessCode(code: string): Promise<'ok' | 'wrong' | 'unreachable'> {
  if (!nativeFetch) return 'unreachable'
  try {
    const res = await nativeFetch(`${API_BASE}/api/credits`, { headers: { authorization: `Bearer ${code}`, accept: 'application/json' } })
    if (res.status === 401 || res.status === 429) return 'wrong'
    return res.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/** With VITE_API_BASE set: sends every relative /api request to the hosted server with the saved access code, and
 *  hands the response back untouched (streams and AbortSignals included). A 401 'access' asks for the code. */
function installHostedApi(): void {
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return real(input, init)
    const target = `${API_BASE}${url.pathname}${url.search}`
    const code = storedCode()
    const send = (): Promise<Response> => {
      if (input instanceof Request) {
        const req = new Request(target, input)
        if (code && !req.headers.has('authorization')) req.headers.set('authorization', `Bearer ${code}`)
        return real(req, init)
      }
      const headers = new Headers(init?.headers)
      if (code && !headers.has('authorization')) headers.set('authorization', `Bearer ${code}`)
      return real(target, { ...init, headers })
    }
    return send().then((res) => {
      if (res.status === 401) {
        void res
          .clone()
          .json()
          .then((body: { code?: string } | null) => {
            if (body?.code === 'access') window.dispatchEvent(new Event(ACCESS_EVENT))
          })
          .catch(() => undefined)
      }
      return res
    })
  }
}

/** Installs the fetch shim for the build: the 503 stand-in for the Pages preview, or the hosted-server forwarder. */
export function installNoBackend(): void {
  if (typeof window === 'undefined') return
  if (API_BASE) return installHostedApi()
  if (!STATIC_PREVIEW) return
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
