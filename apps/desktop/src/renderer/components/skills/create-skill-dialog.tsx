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

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { InlineError } from "../inline-error.js"
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
  const [actionError, setActionError] = useState<string | null>(null)

  // Workbench's error strip sits under the scrim, so the failure is repeated
  // here and the draft stays put.
  async function create() {
    setSaving(true)
    setActionError(null)
    try {
      await onCreate(draft)
      setDraft(emptySkillDraft())
      onOpenChange(false)
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saving) return
    if (!nextOpen) {
      setDraft(emptySkillDraft())
      setActionError(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!saving}>
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
        {actionError ? <InlineError message={actionError} /> : null}
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
