import fs from 'node:fs'
import path from 'node:path'

/* Typed JSON persistence under the data directory (DAEMON_DATA_DIR, default <project>/.data).
   Every write goes to a temp file in the same directory and is renamed over the target, so a crash never leaves a
   half-written file. Writes to one file are serialised and coalesced: the latest value wins, and it is serialised at
   the moment the write actually runs. Reads tolerate a missing or corrupt file (a corrupt one is kept as <file>.bak). */

export interface SaveOptions {
  /** File mode for the file (secrets use 0o600). */
  mode?: number
}

export interface Store {
  dir: string
  /** Read and parse a file relative to the data dir. Missing => fallback. Corrupt => fallback, original kept as .bak. */
  load<T>(rel: string, fallback: T, validate?: (value: unknown) => value is T): T
  /** Queue an atomic write of `value` (a live reference: it is serialised when the write runs). */
  save(rel: string, value: unknown, options?: SaveOptions): Promise<void>
  /** Delete a file (after any queued write to it). */
  remove(rel: string): Promise<void>
  /** List file names (not paths) in a subdirectory. */
  list(rel: string): string[]
  /** Resolves once every queued write has hit the disk. */
  flush(): Promise<void>
}

export function resolveDataDir(root: string, envValue: string | undefined): string {
  const value = envValue?.trim()
  return value ? path.resolve(value) : path.join(root, '.data')
}

export function createStore(dir: string): Store {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    /* a shared mount may refuse; the secrets file keeps its own 0600 */
  }
  const abs = (rel: string) => {
    const full = path.resolve(dir, rel)
    if (full !== dir && !full.startsWith(dir + path.sep)) throw new Error('Path escapes the data directory.')
    return full
  }

  const chains = new Map<string, Promise<void>>()
  const pending = new Map<string, { value: unknown; options: SaveOptions }>()
  /** The newest saved value per file until its write has landed: a read right after a save sees the save. */
  const latest = new Map<string, unknown>()
  let tmpSeq = 0

  const enqueue = (rel: string, task: () => Promise<void>): Promise<void> => {
    const prev = chains.get(rel) ?? Promise.resolve()
    const next = prev.then(task, task)
    const tracked = next.catch(() => undefined)
    chains.set(rel, tracked)
    void tracked.then(() => {
      if (chains.get(rel) === tracked) chains.delete(rel)
    })
    return next
  }

  async function write(rel: string): Promise<void> {
    const job = pending.get(rel)
    if (!job) return // an earlier queued write already carried the latest value
    pending.delete(rel)
    const file = abs(rel)
    const wrote = job.value
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${++tmpSeq}.tmp`)
    const text = JSON.stringify(job.value)
    try {
      await fs.promises.writeFile(tmp, text, { mode: job.options.mode ?? 0o600 })
      if (job.options.mode !== undefined) await fs.promises.chmod(tmp, job.options.mode)
      await fs.promises.rename(tmp, file)
      if (latest.get(rel) === wrote && !pending.has(rel)) latest.delete(rel)
    } catch (err) {
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined)
      throw err
    }
  }

  return {
    dir,
    load<T>(rel: string, fallback: T, validate?: (value: unknown) => value is T): T {
      const file = abs(rel)
      if (latest.has(rel)) return JSON.parse(JSON.stringify(latest.get(rel))) as T
      let text: string
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        return fallback
      }
      try {
        const parsed: unknown = JSON.parse(text)
        if (validate && !validate(parsed)) throw new Error('unexpected shape')
        return parsed as T
      } catch {
        try {
          fs.copyFileSync(file, `${file}.bak`)
        } catch {
          /* best effort */
        }
        console.error(`[store] ${rel} was unreadable; starting empty (a copy is kept as ${path.basename(file)}.bak).`)
        return fallback
      }
    },
    save(rel, value, options = {}) {
      abs(rel)
      latest.set(rel, value)
      pending.set(rel, { value, options })
      return enqueue(rel, () => write(rel)).catch((err) => {
        console.error(`[store] could not write ${rel}:`, err instanceof Error ? err.message : String(err))
      })
    },
    remove(rel) {
      const file = abs(rel)
      pending.delete(rel)
      latest.delete(rel)
      return enqueue(rel, async () => {
        pending.delete(rel)
        latest.delete(rel)
        await fs.promises.rm(file, { force: true })
      }).catch(() => undefined)
    },
    list(rel) {
      try {
        return fs.readdirSync(abs(rel)).filter((n) => !n.startsWith('.'))
      } catch {
        return []
      }
    },
    async flush() {
      for (let i = 0; i < 5 && chains.size > 0; i++) await Promise.all([...chains.values()])
    },
  }
}
