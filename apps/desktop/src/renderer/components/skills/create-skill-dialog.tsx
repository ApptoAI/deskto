import { useState } from "react"
import { mySkillsPackName, type ManagedSkillDraft } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import {
  emptySkillDraft,
  isCompleteSkillDraft,
  SkillDraftFields,
} from "./skill-draft-fields.js"

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (draft: ManagedSkillDraft) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(emptySkillDraft)

  async function create() {
    setSaving(true)
    try {
      await onCreate(draft)
      setDraft(emptySkillDraft())
      onOpenChange(false)
    } catch {
      // Workbench shows mutation failures in its error strip.
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setDraft(emptySkillDraft())
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a skill</DialogTitle>
          <DialogDescription>
            Deskto will save it in {mySkillsPackName} and make it available in
            this workspace.
          </DialogDescription>
        </DialogHeader>
        <SkillDraftFields
          idPrefix="new-skill"
          draft={draft}
          autoFocus
          onChange={setDraft}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !isCompleteSkillDraft(draft)}
            onClick={() => void create()}
          >
            {saving ? "Creating..." : "Create skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
