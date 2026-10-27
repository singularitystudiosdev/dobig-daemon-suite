import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { apiPlugin } from './server/plugin.ts'

/** node_modules can resolve outside the project root (worktrees, linked installs); fs.strict stays on. */
function fsAllow(): string[] {
  const allow = [searchForWorkspaceRoot(process.cwd())]
  try {
    allow.push(path.dirname(fs.realpathSync('node_modules')))
  } catch {
    /* no node_modules yet */
  }
  return allow
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { fs: { strict: true, allow: fsAllow() } },
})
