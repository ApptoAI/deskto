import { useState } from "react"
import type { SkillDetails, SkillSource } from "@deskto/protocol"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"

import { Button } from "@workspace/ui/components/button"
import { Markdown } from "@workspace/ui/components/chat/markdown"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { InlineError } from "../inline-error.js"
import { openFolder } from "../../lib/desktop.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"

export function SkillDetailsDialog({
  open,
  state,
  source,
  onClose,
  onRetry,
  onUpdateManaged,
}: {
  open: boolean
  state: QueryState<SkillDetails>
  source: SkillSource | undefined
  onClose: () => void
  onRetry: () => void
  onUpdateManaged?: (
    packId: string,
    directoryName: string,
    draft: { name: string; description: string; instructions: string }
  ) => Promise<void>
}) {
  const details = state.status === "ready" ? state.data : null
  const occurrence = details?.occurrence
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [instructions, setInstructions] = useState("")

  function beginEditing() {
    if (!occurrence) return
    setSaveError(null)
    setName(occurrence.name ?? "")
    setDescription(occurrence.description ?? "")
    setInstructions(instructionsFromSkillContent(details?.content ?? ""))
    setEditing(true)
  }

  function closeDialog() {
    setEditing(false)
    setSaveError(null)
    onClose()
  }

  async function save() {
    if (!source?.packId || !occurrence || !onUpdateManaged) return
    setSaving(true)
    setSaveError(null)
    try {
      await onUpdateManaged(source.packId, occurrence.directoryName, {
        name,
        description,
        instructions,
      })
      setEditing(false)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
      <DialogContent className="max-h-[min(44rem,calc(100%-2rem))] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {occurrence?.name ?? occurrence?.directoryName ?? "Skill details"}
          </DialogTitle>
          <DialogDescription>
            {occurrence?.description ??
              (state.status === "loading"
                ? "Reading this skill..."
                : "See where this skill came from and what it tells the agent to do.")}
          </DialogDescription>
        </DialogHeader>

        {state.status === "error" ? (
          <div className="space-y-3">
            <InlineError message={state.message} />
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : state.status === "loading" || state.status === "idle" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Reading skill...
          </p>
        ) : occurrence ? (
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {editing ? (
              <section className="space-y-3 rounded-lg border border-border p-4">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label="Skill name"
                />
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  aria-label="Skill description"
                />
                <Textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  aria-label="Skill instructions"
                  className="min-h-48"
                />
                {saveError ? <InlineError message={saveError} /> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    Cancel editing
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      saving ||
                      !name.trim() ||
                      !description.trim() ||
                      !instructions.trim()
                    }
                    onClick={() => void save()}
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                </div>
              </section>
            ) : null}
            <dl className="grid gap-3 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="mt-0.5 font-medium">
                  {source?.label ?? "Unknown source"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Folder</dt>
                <dd
                  className="mt-0.5 truncate font-mono"
                  title={occurrence.directoryPath}
                >
                  {occurrence.directoryPath}
                </dd>
              </div>
            </dl>

            {source?.kind === "pack" ? (
              <section aria-labelledby="skill-provisioning-heading">
                <h2
                  id="skill-provisioning-heading"
                  className="text-sm font-medium"
                >
                  Latest project configuration
                </h2>
                {source.provisioning.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    This Pack has not been provided to an agent in this project
                    yet.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {source.provisioning.map((report) => (
                      <li
                        key={`${report.harnessId}:${report.turnId}`}
                        className="rounded-lg border border-border p-3"
                      >
                        <p className="font-medium">
                          {report.harnessId === "claude"
                            ? "Claude Code"
                            : report.harnessId === "codex"
                              ? "Codex"
                              : report.harnessId}
                          : {report.status}
                        </p>
                        {report.message ? (
                          <p className="mt-1 text-muted-foreground">
                            {report.message}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            {occurrence.diagnostics.length > 0 ? (
              <section aria-labelledby="skill-diagnostics-heading">
                <h2
                  id="skill-diagnostics-heading"
                  className="text-sm font-medium"
                >
                  Needs attention
                </h2>
                <ul className="mt-2 space-y-2">
                  {occurrence.diagnostics.map((diagnostic) => (
                    <li
                      key={`${diagnostic.code}:${diagnostic.path}`}
                      className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm"
                    >
                      {diagnostic.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="skill-instructions-heading">
              <h2
                id="skill-instructions-heading"
                className="text-sm font-medium"
              >
                Instructions
              </h2>
              {details.content ? (
                <Markdown className="mt-2 rounded-lg border border-border p-4">
                  {instructionsFromSkillContent(details.content)}
                </Markdown>
              ) : (
                <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Instructions could not be read.
                </p>
              )}
            </section>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={closeDialog}>
            Close
          </Button>
          {occurrence ? (
            source?.packKind === "managed" && onUpdateManaged ? (
              <Button
                type="button"
                variant="outline"
                disabled={editing}
                onClick={beginEditing}
              >
                Edit skill
              </Button>
            ) : null
          ) : null}
          {occurrence ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void openFolder(occurrence.directoryPath)}
            >
              <FolderOpenIcon data-icon="inline-start" />
              Open folder
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function instructionsFromSkillContent(content: string): string {
  return content
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/, "")
    .trim()
}
