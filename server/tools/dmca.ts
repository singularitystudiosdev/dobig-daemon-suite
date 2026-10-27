import { RunError, type ToolModule } from './types.ts'

// Placeholder until the dmca tool worker builds the real analyzer.
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('internal', 'The dmca analyzer is not built yet.')
  },
}
