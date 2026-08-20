import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { UpdateState } from "../../shared/desktop-api.js"

type UpdatesContextValue = {
  state: UpdateState | null
  loadError: string | null
  actionError: string | null
  check: () => Promise<void>
  install: () => Promise<void>
}

const UpdatesContext = createContext<UpdatesContextValue | null>(null)

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const receivedEvent = useRef(false)

  useEffect(() => {
    let active = true
    const unsubscribe = window.deskto.updates.subscribe((next: UpdateState) => {
      receivedEvent.current = true
      setLoadError(null)
      setState(next)
    })
    void window.deskto.updates
      .state()
      .then((initial: UpdateState) => {
        if (active && !receivedEvent.current) setState(initial)
      })
      .catch(() => {
        if (active) {
          setLoadError(
            "Deskto couldn't read update status. Quit Deskto and open it again."
          )
        }
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const runUpdateAction = useCallback(
    async (action: () => Promise<void>, message: string) => {
      setActionError(null)
      try {
        await action()
      } catch {
        setActionError(message)
      }
    },
    []
  )
  const check = useCallback(
    () =>
      runUpdateAction(
        () => window.deskto.updates.check(),
        "Deskto couldn't start the update check. Quit Deskto and open it again."
      ),
    [runUpdateAction]
  )
  const install = useCallback(
    () =>
      runUpdateAction(
        () => window.deskto.updates.install(),
        "Deskto couldn't restart for the update. Quit Deskto and open it again to install it."
      ),
    [runUpdateAction]
  )
  const value = useMemo(
    () => ({ state, loadError, actionError, check, install }),
    [state, loadError, actionError, check, install]
  )

  return (
    <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>
  )
}

export function useUpdates(): UpdatesContextValue {
  const value = useContext(UpdatesContext)
  if (!value) throw new Error("useUpdates must be used within UpdatesProvider")
  return value
}
