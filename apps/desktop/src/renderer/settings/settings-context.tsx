import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react"
import {
  settingValue,
  type SettingDefinition,
  type SettingsSnapshot,
} from "@openappto/settings"

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
  update: (entries: Record<string, unknown>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const client = useRuntimeClient()
  const load = useCallback(() => client.getSettings(), [client])
  const query = useRuntimeQuery(load)
  const { revalidate, replace } = query

  useSettingsChanged(useCallback(() => revalidate(), [revalidate]))

  const update = useCallback(
    async (entries: Record<string, unknown>) => {
      replace(await client.updateSettings(entries))
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
export function useSettingValue<T>(definition: SettingDefinition<T>): T {
  return settingValue(useSettings().snapshot, definition)
}
