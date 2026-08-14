import { useState } from "react"
import type { Pack, Workspace } from "@openappto/protocol"

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
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import {
  WorkspaceIcon,
  workspaceColors,
  workspaceIcons,
  workspaceSwatch,
} from "./workspace-theme.js"

export type WorkspaceDraft = { name: string; color: string; icon: string }

export type PackActions = {
  onToggle: (packId: string, attached: boolean) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onImport: () => Promise<void>
  onRemove: (packId: string) => Promise<void>
}

/** Creates a workspace when `workspace` is null, edits it otherwise. */
export function WorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  canDelete,
  packs,
  packActions,
  onSubmit,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  canDelete: boolean
  packs: Pack[]
  packActions: PackActions
  onSubmit: (draft: WorkspaceDraft) => Promise<void>
  onDelete: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <WorkspaceForm
            key={workspace?.id ?? "create"}
            workspace={workspace}
            canDelete={canDelete}
            packs={packs}
            packActions={packActions}
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
  packs,
  packActions,
  onSubmit,
  onDelete,
  onClose,
}: {
  workspace: Workspace | null
  canDelete: boolean
  packs: Pack[]
  packActions: PackActions
  onSubmit: (draft: WorkspaceDraft) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(workspace?.name ?? "")
  const [color, setColor] = useState(workspace?.color ?? workspaceColors[0]!)
  const [icon, setIcon] = useState(workspace?.icon ?? workspaceIcons[0]!)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // The host surfaces failures; the form only stays open so nothing is lost.
  async function submit() {
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), color, icon })
      onClose()
    } catch {
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await onDelete()
      onClose()
    } catch {
      setConfirmingDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {workspace ? "Edit workspace" : "New workspace"}
        </DialogTitle>
      </DialogHeader>

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
            placeholder="Press, Personal, Clients…"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label>Color</Label>
          <div className="flex flex-wrap gap-2">
            {workspaceColors.map((candidate) => (
              <button
                key={candidate}
                type="button"
                title={candidate}
                aria-label={`Color ${candidate}`}
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

        {workspace ? (
          <PackSection workspace={workspace} packs={packs} {...packActions} />
        ) : null}

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
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
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

/** Attach and detach skill Packs; content is edited on disk, previewed here. */
function PackSection({
  workspace,
  packs,
  onToggle,
  onCreate,
  onImport,
  onRemove,
}: { workspace: Workspace; packs: Pack[] } & PackActions) {
  const [newPackName, setNewPackName] = useState("")
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch {
      // The host surfaces failures.
    } finally {
      setBusy(false)
    }
  }

  function createNewPack() {
    const name = newPackName.trim()
    if (!name || busy) return
    void run(async () => {
      await onCreate(name)
      setNewPackName("")
    })
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <Label>Packs</Label>
      {packs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Packs are folders of skills you can share between workspaces.
        </p>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {packs.map((pack) => (
            <li key={pack.id} className="flex items-start gap-2 py-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{pack.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {pack.skills.length === 0
                    ? "No skills yet"
                    : pack.skills.map((skill) => skill.name).join(", ")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                disabled={busy}
                onClick={() => void run(() => onRemove(pack.id))}
              >
                Remove
              </Button>
              <Switch
                checked={pack.workspaceIds.includes(workspace.id)}
                disabled={busy}
                onCheckedChange={(checked) =>
                  void run(() => onToggle(pack.id, checked === true))
                }
                aria-label={`Use ${pack.name} in this workspace`}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={newPackName}
          onChange={(event) => setNewPackName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            createNewPack()
          }}
          placeholder="New pack name"
          className="h-7 flex-1 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || !newPackName.trim()}
          onClick={createNewPack}
        >
          Create
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(onImport)}
        >
          Import…
        </Button>
      </div>
    </div>
  )
}
