import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import {
  settingValue,
  type SettingDefinition,
  type SettingValue,
  type SettingValues,
  type SettingsSnapshot,
} from "@deskto/settings"

import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { useSettingsChanged } from "../runtime/use-settings-changed.js"

type SettingsContextValue = {
  /** Null while settings load or failed; readers fall back to defaults. */
  snapshot: SettingsSnapshot | null
  /** Why settings failed to load, or null. */
  loadError: string | null
  retry: () => void
  /** Applies overrides; a null entry clears one back to its default. */
  update: (entries: SettingValues) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const client = useRuntimeClient()
  const load = useCallback(() => client.getSettings(), [client])
  const query = useRuntimeQuery(load)
  const { revalidate, replace } = query
  const updateQueue = useRef<Promise<void>>(Promise.resolve())

  useSettingsChanged(useCallback(() => revalidate(), [revalidate]))

  const update = useCallback(
    (entries: SettingValues) => {
      const request = updateQueue.current.then(() =>
        client.updateSettings(entries)
      )
      updateQueue.current = request.then(
        (nextSnapshot) => replace(nextSnapshot),
        () => undefined
      )
      return request.then(() => undefined)
    },
    [client, replace]
  )

  const snapshot = query.state.status === "ready" ? query.state.data : null
  const loadError = query.state.status === "error" ? query.state.message : null
  const value = useMemo(
    () => ({ snapshot, loadError, retry: revalidate, update }),
    [snapshot, loadError, revalidate, update]
  )

  return <SettingsContext value={value}>{children}</SettingsContext>
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value)
    throw new Error("useSettings must be used inside SettingsProvider.")
  return value
}

/** Reads one setting, serving its default while settings load. */
export function useSettingValue<T extends SettingValue>(
  definition: SettingDefinition<T>
): T {
  return settingValue(useSettings().snapshot, definition)
}
