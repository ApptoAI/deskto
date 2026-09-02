import { useState } from "react"
import { computerUseSettings, settingValue } from "@deskto/settings"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useSettings } from "../../settings/settings-context.js"
import { ToggleSettingRow } from "./computer-use-browser-section.js"

export function ScreenControlSettingsSection() {
  const { snapshot, update } = useSettings()
  const [error, setError] = useState<string>()
  const enabled = computerUseSettings.screenControlEnabled

  async function commit(value: boolean): Promise<boolean> {
    try {
      await update({ [enabled.key]: value })
      setError(undefined)
      return true
    } catch (caught) {
      setError(describedErrorSchema.parse(caught))
      return false
    }
  }

  return (
    <ul className="divide-y divide-border">
      <ToggleSettingRow
        definition={enabled}
        value={settingValue(snapshot, enabled)}
        error={error}
        onCommit={commit}
      />
    </ul>
  )
}
