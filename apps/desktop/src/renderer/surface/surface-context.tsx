import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import type { SurfaceCommand } from "../commands/surface-commands.js"
import type { SurfaceNavigationHost } from "./navigation.js"
import { SurfaceApi } from "./surface-api.js"

const SurfaceContext = createContext<SurfaceApi | null>(null)

export function SurfaceProvider({ children }: { children: ReactNode }) {
  const [surface] = useState(() => new SurfaceApi())
  return <SurfaceContext value={surface}>{children}</SurfaceContext>
}

export function useSurface(): SurfaceApi {
  const surface = useContext(SurfaceContext)
  if (!surface)
    throw new Error("useSurface must be used inside SurfaceProvider.")
  return surface
}

export function useSurfaceCommand(command: SurfaceCommand): void {
  const surface = useSurface()
  useEffect(
    () => surface.commands.register(command),
    [command, surface.commands]
  )
}

export function useSurfaceNavigation(host: SurfaceNavigationHost): void {
  const surface = useSurface()
  useEffect(() => surface.navigation.register(host), [host, surface.navigation])
}

export function useTaskPanelState(threadId: string) {
  const surface = useSurface()
  return useSyncExternalStore(surface.panel.subscribe, () =>
    surface.panel.state(threadId)
  )
}
