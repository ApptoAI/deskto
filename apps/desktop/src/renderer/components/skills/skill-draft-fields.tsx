import type { ManagedSkillDraft } from "@deskto/protocol"

import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"

export function emptySkillDraft(): ManagedSkillDraft {
  return { name: "", description: "", instructions: "" }
}

export function isCompleteSkillDraft(draft: ManagedSkillDraft): boolean {
  return Boolean(
    draft.name.trim() && draft.description.trim() && draft.instructions.trim()
  )
}

export function SkillDraftFields({
  idPrefix,
  draft,
  autoFocus = false,
  onChange,
}: {
  idPrefix: string
  draft: ManagedSkillDraft
  autoFocus?: boolean
  onChange: (draft: ManagedSkillDraft) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-name`} className="text-xs font-medium">
          Name
        </label>
        <Input
          id={`${idPrefix}-name`}
          className="mt-1.5"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="release-notes"
          autoFocus={autoFocus}
        />
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-description`}
          className="text-xs font-medium"
        >
          When to use it
        </label>
        <Input
          id={`${idPrefix}-description`}
          className="mt-1.5"
          value={draft.description}
          onChange={(event) =>
            onChange({ ...draft, description: event.target.value })
          }
          placeholder="Use when preparing release notes from a change set"
        />
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-instructions`}
          className="text-xs font-medium"
        >
          Instructions
        </label>
        <Textarea
          id={`${idPrefix}-instructions`}
          className="mt-1.5 min-h-48"
          value={draft.instructions}
          onChange={(event) =>
            onChange({ ...draft, instructions: event.target.value })
          }
          placeholder="Tell the agent how to do the work"
        />
      </div>
    </div>
  )
}
