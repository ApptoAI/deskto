import { useState } from "react"
import type { Workspace } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

import { describedErrorSchema } from "../../runtime/describe-error.js"
import { InlineError } from "../inline-error.js"
import {
  WorkspaceIcon,
  workspaceColors,
  workspaceIcons,
  workspaceSwatch,
} from "./workspace-theme.js"

export type WorkspaceDraft = { name: string; color: string; icon: string }

/** Creates a workspace when `workspace` is null, edits it otherwise. */
export function WorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  canDelete,
  onSubmit,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  canDelete: boolean
  onSubmit: (draft: WorkspaceDraft) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
    >
      <DialogContent showCloseButton={!busy}>
        {open ? (
          <WorkspaceForm
            key={workspace?.id ?? "create"}
            workspace={workspace}
            canDelete={canDelete}
            busy={busy}
            setBusy={setBusy}
            onSubmit={onSubmit}
            onDelete={onDelete}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceForm({
  workspace,
  canDelete,
  busy,
  setBusy,
  onSubmit,
  onDelete,
  onClose,
}: {
  workspace: Workspace | null
  canDelete: boolean
  busy: boolean
  setBusy: (busy: boolean) => void
  onSubmit: (draft: WorkspaceDraft) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(workspace?.name ?? "")
  const [color, setColor] = useState(workspace?.color ?? workspaceColors[0]!)
  const [icon, setIcon] = useState(workspace?.icon ?? workspaceIcons[0]!)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // The host's error strip sits under the scrim, so the failure has to be
  // repeated here; the form stays open so nothing typed is lost.
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      onClose()
    } catch (error) {
      setConfirmingDelete(false)
      setActionError(describedErrorSchema.parse(error))
    } finally {
      setBusy(false)
    }
  }

  const submit = () => run(() => onSubmit({ name: name.trim(), color, icon }))
  const remove = () => run(onDelete)

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {workspace ? "Edit workspace" : "New workspace"}
        </DialogTitle>
      </DialogHeader>

      {actionError ? <InlineError message={actionError} /> : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) void submit()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="workspace-name">Name</Label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sales, Clients, Publishing…"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label>Colour</Label>
          <div className="flex flex-wrap gap-2">
            {workspaceColors.map((candidate) => (
              <button
                key={candidate}
                type="button"
                title={candidate}
                aria-label={`Colour ${candidate}`}
                aria-pressed={candidate === color}
                onClick={() => setColor(candidate)}
                className={cn(
                  "size-7 rounded-full",
                  workspaceSwatch(candidate),
                  candidate === color
                    ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                    : "opacity-60 hover:opacity-100"
                )}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Icon</Label>
          <div className="flex flex-wrap gap-2">
            {workspaceIcons.map((candidate) => (
              <button
                key={candidate}
                type="button"
                title={candidate}
                aria-label={`Icon ${candidate}`}
                aria-pressed={candidate === icon}
                onClick={() => setIcon(candidate)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border border-border",
                  candidate === icon
                    ? "bg-muted text-foreground ring-2 ring-ring"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <WorkspaceIcon icon={candidate} className="size-4" />
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="items-center">
          {workspace && canDelete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mr-auto"
              disabled={busy}
              onClick={() => {
                if (confirmingDelete) void remove()
                else setConfirmingDelete(true)
              }}
            >
              {confirmingDelete
                ? "Projects move to Personal. Delete?"
                : "Delete workspace"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {workspace ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
