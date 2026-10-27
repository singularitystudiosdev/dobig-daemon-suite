import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import { createApiHandler, isApiUrl, type ApiHandler } from './handler.ts'

/** JSON API under /api, mounted in both `vite` (dev) and `vite preview`. The API itself is server/handler.ts, which
 *  the standalone server (server/standalone.ts) mounts as well. The access gate and CORS are off unless
 *  API_ACCESS_CODE / CORS_ORIGIN are set. */
export function apiPlugin(): Plugin {
  let api: ApiHandler | null = null

  const configure = (config: ResolvedConfig) => {
    const file = loadEnv(config.mode, config.envDir || config.root, '')
    const pick = (name: string) => (process.env[name] ?? file[name] ?? '').trim()
    api = createApiHandler({ root: config.root, pick })
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    if (!api || !isApiUrl(req.url ?? '')) return next()
    void api.handle(req, res)
  }

  return {
    name: 'thumbnail-demo-api',
    configResolved: configure,
    configureServer(server) {
      api?.boot(server.httpServer)
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      api?.boot(server.httpServer)
      server.middlewares.use(handler)
    },
  }
}
