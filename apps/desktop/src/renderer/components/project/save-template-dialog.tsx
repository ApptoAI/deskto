import { useState } from "react"
import {
  projectNameMaxLength,
  projectTemplateDescriptionMaxLength,
  type Project,
  type ProjectTemplateFile,
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
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Textarea } from "@workspace/ui/components/textarea"

import { InlineError } from "../inline-error.js"

export type SaveTemplateDraft = {
  name: string
  description: string
  includeInstructions: boolean
  paths: string[]
}

export function SaveTemplateDialog({
  open,
  onOpenChange,
  project,
  files,
  loading,
  loadError,
  actionError,
  onRetry,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  files: ProjectTemplateFile[]
  loading: boolean
  loadError: string | null
  actionError: string | null
  onRetry: () => void
  onSubmit: (draft: SaveTemplateDraft) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function submit(draft: SaveTemplateDraft) {
    setBusy(true)
    try {
      await onSubmit(draft)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
        {open && project ? (
          <SaveTemplateForm
            key={project.id}
            project={project}
            files={files}
            loading={loading}
            loadError={loadError}
            actionError={actionError}
            onRetry={onRetry}
            busy={busy}
            onSubmit={submit}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SaveTemplateForm({
  project,
  files,
  loading,
  loadError,
  actionError,
  onRetry,
  onSubmit,
  onClose,
  busy,
}: {
  project: Project
  files: ProjectTemplateFile[]
  loading: boolean
  loadError: string | null
  actionError: string | null
  onRetry: () => void
  onSubmit: (draft: SaveTemplateDraft) => Promise<void>
  onClose: () => void
  busy: boolean
}) {
  const [name, setName] = useState(`${project.name} template`)
  const [description, setDescription] = useState("")
  const [includeInstructions, setIncludeInstructions] = useState(true)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set()
  )

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function submit() {
    if (!name.trim()) return
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        includeInstructions,
        paths: [...selectedPaths].sort(),
      })
    } catch {
      // The workbench shows the error without discarding the selection.
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save as template</DialogTitle>
        <DialogDescription>
          Choose exactly which files future projects should receive.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="template-name">Name</Label>
          <Input
            id="template-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={projectNameMaxLength}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="template-description">Description</Label>
          <Textarea
            id="template-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={projectTemplateDescriptionMaxLength}
            disabled={busy}
            placeholder="When should this template be used?"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInstructions}
            disabled={busy}
            onChange={(event) => setIncludeInstructions(event.target.checked)}
            className="size-4 accent-foreground"
          />
          Include shared Project instructions
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Starter files</Label>
            {files.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setSelectedPaths(
                    selectedPaths.size === files.length
                      ? new Set()
                      : new Set(files.map((file) => file.path))
                  )
                }
              >
                {selectedPaths.size === files.length
                  ? "Select none"
                  : "Select all"}
              </Button>
            ) : null}
          </div>
          <ScrollArea className="h-44 rounded-lg border border-border">
            <div className="divide-y divide-border">
              {loading ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Scanning files…
                </p>
              ) : files.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No safe starter files found. You can still save the
                  instructions.
                </p>
              ) : (
                files.map((file) => (
                  <label
                    key={file.path}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPaths.has(file.path)}
                      disabled={busy}
                      onChange={() => togglePath(file.path)}
                      className="size-4 accent-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{file.path}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </label>
                ))
              )}
            </div>
          </ScrollArea>
          <p className="text-xs text-muted-foreground">
            Secrets, dependencies, caches, and build output are excluded.
          </p>
        </div>

        {loadError ? (
          <div className="space-y-2">
            <InlineError message={loadError} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onRetry}
            >
              Retry file scan
            </Button>
          </div>
        ) : actionError ? (
          <InlineError message={actionError} />
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || loading || loadError !== null || !name.trim()}
          >
            {busy ? "Saving…" : "Save template"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  return `${Math.ceil(bytes / 1_024)} KB`
}
