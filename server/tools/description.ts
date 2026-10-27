import { RunError, type ToolModule } from './types.ts'

// Placeholder until the description tool worker builds the real analyzer.
export const tool: ToolModule = {
  async analyze() {
    throw new RunError('internal', 'The description analyzer is not built yet.')
  },
}
