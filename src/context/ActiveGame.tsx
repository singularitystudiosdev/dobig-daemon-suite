import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { games, gamesById, type Game } from '@/data/games'

/* The game every daemon is attached to. Picked in the tool header, shared by all six tools. */

interface ActiveGameValue {
  game: Game
  setGameId: (id: string) => void
}

const ActiveGameContext = createContext<ActiveGameValue | null>(null)
const STORAGE_KEY = 'dobig.daemons.activeGame'

/** `#/d/<slug>?game=<id>` deep-links a daemon page to a specific game. */
function gameFromHash() {
  const q = window.location.hash.split('?')[1]
  const id = q ? new URLSearchParams(q).get('game') : null
  return id && gamesById[id] ? id : null
}

export function ActiveGameProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return gameFromHash() ?? (saved && gamesById[saved] ? saved : games[0].id)
  })
  const setGameId = useCallback((next: string) => {
    if (!gamesById[next]) return
    window.localStorage.setItem(STORAGE_KEY, next)
    setId(next)
  }, [])
  useEffect(() => {
    const onHash = () => {
      const linked = gameFromHash()
      if (linked) setGameId(linked)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [setGameId])
  const value = useMemo(() => ({ game: gamesById[id], setGameId }), [id, setGameId])
  return <ActiveGameContext.Provider value={value}>{children}</ActiveGameContext.Provider>
}

export function useActiveGame() {
  const ctx = useContext(ActiveGameContext)
  if (!ctx) throw new Error('useActiveGame must be used inside ActiveGameProvider')
  return ctx
}
