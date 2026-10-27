import { RunError, type ToolModule } from './types.ts'

/* Pulse Daemon analyzer. Owned by the Pulse Daemon worker: replace this skeleton. */
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('upstream', 'Pulse Daemon is not built yet.')
  },
}
