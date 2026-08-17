import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

/**
 * Shared by every file editor so saving reads the same way whatever the
 * format is: format-specific controls on the left, discard and save on the
 * right, and no automatic write behind the user's back.
 */
export function EditorToolbar({
  leading,
  dirty,
  saving,
  onDiscard,
  onSave,
}: {
  leading?: ReactNode
  dirty: boolean
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">{leading}</div>
      <Button
        variant="ghost"
        size="sm"
        disabled={!dirty || saving}
        onClick={onDiscard}
      >
        Discard
      </Button>
      <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  )
}
