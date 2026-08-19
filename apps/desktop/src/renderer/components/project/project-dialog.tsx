import { useState } from "react"
import { projectNameMaxLength, type ProjectTemplate } from "@deskto/protocol"

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
import { cn } from "@workspace/ui/lib/utils"

import { InlineError } from "../inline-error.js"

export type ProjectDraft = {
  name: string
  location: { kind: "managed" } | { kind: "linked"; path: string }
  templateId?: string
}

type PickedFolder = { path: string; name: string }

export function ProjectDialog({
  open,
  onOpenChange,
  templates,
  templatesLoading,
  loadError,
  actionError,
  onRetry,
  onChooseFolder,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: ProjectTemplate[]
  templatesLoading: boolean
  loadError: string | null
  actionError: string | null
  onRetry: () => void
  onChooseFolder: () => Promise<PickedFolder | undefined>
  onSubmit: (draft: ProjectDraft) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  async function submit(draft: ProjectDraft) {
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
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        {open ? (
          <ProjectForm
            templates={templates}
            templatesLoading={templatesLoading}
            loadError={loadError}
            actionError={actionError}
            onRetry={onRetry}
            onChooseFolder={onChooseFolder}
            busy={busy}
            onSubmit={submit}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProjectForm({
  templates,
  templatesLoading,
  loadError,
  actionError,
  onRetry,
  onChooseFolder,
  onSubmit,
  onClose,
  busy,
}: {
  templates: ProjectTemplate[]
  templatesLoading: boolean
  loadError: string | null
  actionError: string | null
  onRetry: () => void
  onChooseFolder: () => Promise<PickedFolder | undefined>
  onSubmit: (draft: ProjectDraft) => Promise<void>
  onClose: () => void
  busy: boolean
}) {
  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [locationKind, setLocationKind] = useState<"managed" | "linked">(
    "managed"
  )
  const [folder, setFolder] = useState<PickedFolder | null>(null)

  async function chooseFolder() {
    const picked = await onChooseFolder()
    if (!picked) return
    setFolder(picked)
    setLocationKind("linked")
    setName((current) => current || picked.name)
  }

  async function submit() {
    const normalizedName = name.trim()
    if (!normalizedName) return
    let location: ProjectDraft["location"]
    if (locationKind === "managed") {
      location = { kind: "managed" }
    } else {
      if (!folder) return
      location = { kind: "linked", path: folder.path }
    }
    try {
      await onSubmit({
        name: normalizedName,
        location,
        ...(templateId ? { templateId } : undefined),
      })
    } catch {
      // The workbench shows the Runtime error and keeps this draft open.
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Start in a folder managed by Deskto or choose one now.
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
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Client North"
            maxLength={projectNameMaxLength}
            disabled={busy}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-template">Template</Label>
          <select
            id="project-template"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            disabled={busy || templatesLoading}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring"
          >
            <option value="">
              {templatesLoading ? "Loading templates…" : "Blank project"}
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.packName}
              </option>
            ))}
          </select>
          {templateId ? (
            <p className="text-xs text-muted-foreground">
              {
                templates.find((template) => template.id === templateId)
                  ?.description
              }
            </p>
          ) : null}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Location</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={locationKind === "managed"}
              disabled={busy}
              onClick={() => setLocationKind("managed")}
              className={locationOption(locationKind === "managed")}
            >
              <span className="font-medium">Managed by Deskto</span>
              <span className="text-xs text-muted-foreground">
                Choose another folder later.
              </span>
            </button>
            <button
              type="button"
              aria-pressed={locationKind === "linked"}
              disabled={busy}
              onClick={() => void chooseFolder()}
              className={locationOption(locationKind === "linked")}
            >
              <span className="font-medium">Choose folder</span>
              <span className="truncate text-xs text-muted-foreground">
                {folder?.path ?? "Use an existing local folder."}
              </span>
            </button>
          </div>
        </fieldset>

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
              Retry templates
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
            disabled={
              busy ||
              !name.trim() ||
              (locationKind === "linked" && folder === null)
            }
          >
            {busy ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function locationOption(selected: boolean): string {
  return cn(
    "flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected
      ? "border-ring bg-muted"
      : "border-border hover:border-muted-foreground"
  )
}
