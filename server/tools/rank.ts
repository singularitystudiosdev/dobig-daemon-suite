import { RunError, type ToolModule } from './types.ts'

/* Rank Daemon analyzer. Owned by the Rank Daemon worker: replace this skeleton. */
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('upstream', 'Rank Daemon is not built yet.')
  },
}
