import { useState } from "react"
import {
  projectInstructionsMaxLength,
  projectNameMaxLength,
  type ProjectDetails,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

import { InlineError } from "../inline-error.js"

export type ProjectSettingsDraft = { name: string; instructions: string }

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  details,
  loading,
  loadError,
  actionError,
  onRetry,
  onSubmit,
  onMoveFolder,
  onOpenFolder,
  onSaveAsTemplate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  details: ProjectDetails | null
  loading: boolean
  loadError: string | null
  actionError: string | null
  onRetry: () => void
  onSubmit: (draft: ProjectSettingsDraft) => Promise<void>
  onMoveFolder: () => Promise<void>
  onOpenFolder: () => void
  onSaveAsTemplate: () => void
}) {
  const [operation, setOperation] = useState<"saving" | "moving" | null>(null)

  async function runOperation(
    next: "saving" | "moving",
    action: () => Promise<void>
  ) {
    setOperation(next)
    try {
      await action()
    } finally {
      setOperation(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (operation === null) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={operation === null}
      >
        {open ? (
          details ? (
            <ProjectSettingsForm
              key={details.project.id}
              details={details}
              operation={operation}
              loadError={loadError}
              actionError={actionError}
              onRetry={onRetry}
              onSubmit={(draft) =>
                runOperation("saving", () => onSubmit(draft))
              }
              onMoveFolder={() => runOperation("moving", onMoveFolder)}
              onOpenFolder={onOpenFolder}
              onSaveAsTemplate={onSaveAsTemplate}
              onClose={() => onOpenChange(false)}
            />
          ) : (
            <ProjectSettingsLoading
              loading={loading}
              error={loadError}
              onRetry={onRetry}
            />
          )
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProjectSettingsLoading({
  loading,
  error,
  onRetry,
}: {
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
      </DialogHeader>
      {error ? (
        <div className="space-y-2 py-4">
          <InlineError message={error} />
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">
          {loading ? "Loading project…" : "Project settings are unavailable."}
        </p>
      )}
    </>
  )
}

function ProjectSettingsForm({
  details,
  operation,
  loadError,
  actionError,
  onRetry,
  onSubmit,
  onMoveFolder,
  onOpenFolder,
  onSaveAsTemplate,
  onClose,
}: {
  details: ProjectDetails
  operation: "saving" | "moving" | null
  loadError: string | null
  actionError: string | null
  onRetry: () => void
  onSubmit: (draft: ProjectSettingsDraft) => Promise<void>
  onMoveFolder: () => Promise<void>
  onOpenFolder: () => void
  onSaveAsTemplate: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(details.project.name)
  const [instructions, setInstructions] = useState(details.instructions)
  const busy = operation !== null

  async function submit() {
    if (!name.trim()) return
    try {
      await onSubmit({ name: name.trim(), instructions })
      onClose()
    } catch {
      // The workbench owns the visible error.
    }
  }

  async function moveFolder() {
    try {
      await onMoveFolder()
    } catch {
      // The workbench owns the visible error.
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
        <DialogDescription>
          Shared instructions apply to every agent used in this project.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="project-settings-name">Name</Label>
          <Input
            id="project-settings-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={projectNameMaxLength}
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-instructions">Shared instructions</Label>
          <Textarea
            id="project-instructions"
            className="min-h-40 resize-y"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={projectInstructionsMaxLength}
            disabled={busy}
            placeholder="Describe terminology, constraints, and how work should be done."
          />
          <p className="text-xs text-muted-foreground">
            Existing AGENTS.md and CLAUDE.md files remain unchanged.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {details.project.locationKind === "managed"
                  ? "Managed by Deskto"
                  : "Linked folder"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {details.project.path}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onOpenFolder}
            >
              Show folder
            </Button>
          </div>
          {details.project.locationKind === "managed" ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void moveFolder()}
              >
                {operation === "moving" ? "Moving…" : "Move to another folder…"}
              </Button>
              <p className="px-2 text-xs text-muted-foreground">
                Choose an empty folder on the same storage volume.
              </p>
            </div>
          ) : null}
        </div>

        {details.sourceTemplate ? (
          <p className="text-xs text-muted-foreground">
            Created from {details.sourceTemplate.name} in{" "}
            {details.sourceTemplate.packName}.
          </p>
        ) : null}

        {loadError ? (
          <div className="space-y-2">
            <InlineError message={loadError} />
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : actionError ? (
          <InlineError message={actionError} />
        ) : null}

        <DialogFooter className="items-center">
          <Button
            type="button"
            variant="outline"
            className="mr-auto"
            disabled={busy}
            onClick={onSaveAsTemplate}
          >
            Save as template…
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {operation === "saving" ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
