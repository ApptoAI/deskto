import { useState } from "react"
import type { Pack, Workspace } from "@deskto/protocol"
import FolderInputIcon from "lucide-react/dist/esm/icons/folder-input"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import FileArchiveIcon from "lucide-react/dist/esm/icons/file-archive"
import PlusIcon from "lucide-react/dist/esm/icons/plus"

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
import { Switch } from "@workspace/ui/components/switch"

import type { RuntimeQuery } from "../../runtime/use-runtime-query.js"
import { openFolder } from "../../lib/desktop.js"

export type PackActions = {
  onToggle: (packId: string, attached: boolean) => Promise<void>
  onCreate: (name: string) => Promise<void>
  onInstallFolder: () => Promise<void>
  onInstallZip: () => Promise<void>
  onLink: () => Promise<void>
  onUnlink: (packId: string) => Promise<void>
  onUninstall: (packId: string) => Promise<void>
}

export function PacksPanel({
  workspace,
  packs,
  actions,
}: {
  workspace: Workspace | null
  packs: RuntimeQuery<Pack[]>
  actions: PackActions
}) {
  const [newPackName, setNewPackName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Pack | null>(null)

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
      return true
    } catch {
      // Workbench shows the error above this screen.
      return false
    } finally {
      setBusy(null)
    }
  }

  function createPack() {
    const name = newPackName.trim()
    if (!name || busy) return
    void run("create", async () => {
      await actions.onCreate(name)
      setNewPackName("")
    })
  }

  if (packs.state.status === "loading" || packs.state.status === "idle") {
    return <PanelMessage title="Reading Packs..." />
  }

  if (packs.state.status === "error") {
    return (
      <PanelMessage
        title="Deskto could not read your Packs"
        description={packs.state.message}
      >
        <Button variant="outline" onClick={packs.revalidate}>
          Try again
        </Button>
      </PanelMessage>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4 border-b border-border pb-5">
        <div className="space-y-1.5">
          <label htmlFor="new-pack-name" className="text-sm font-medium">
            Create a Pack
          </label>
          <div className="flex gap-2">
            <Input
              id="new-pack-name"
              value={newPackName}
              onChange={(event) => setNewPackName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                createPack()
              }}
              placeholder="Pack name"
              disabled={busy !== null}
            />
            <Button
              type="button"
              disabled={busy !== null || !newPackName.trim()}
              onClick={createPack}
            >
              <PlusIcon data-icon="inline-start" />
              Create
            </Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Add an existing Pack</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run("install", actions.onInstallFolder)}
            >
              <FolderInputIcon data-icon="inline-start" />
              Install Pack from folder…
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run("install-zip", actions.onInstallZip)}
            >
              <FileArchiveIcon data-icon="inline-start" />
              Install Pack ZIP…
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void run("link", actions.onLink)}
            >
              <FolderInputIcon data-icon="inline-start" />
              Link Pack folder…
            </Button>
          </div>
        </div>
      </div>

      {!workspace ? (
        <PanelMessage
          title="No workspace selected"
          description="Choose a workspace before attaching a Pack."
        />
      ) : packs.state.data.length === 0 ? (
        <PanelMessage
          title="This workspace has no Packs yet"
          description="Create a Pack here or link a folder that already contains skills."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {packs.state.data.map((pack) => {
            const attached = pack.workspaceIds.includes(workspace.id)
            const rowBusy = busy === pack.id
            const invalidCount = pack.occurrences.filter((occurrence) =>
              occurrence.diagnostics.some(
                (diagnostic) => diagnostic.severity === "error"
              )
            ).length
            return (
              <li key={pack.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{pack.name}</p>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {pack.occurrences.length === 0
                      ? "No skills found"
                      : pack.occurrences
                          .map(
                            (occurrence) =>
                              occurrence.name ?? occurrence.directoryName
                          )
                          .join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pack.kind === "managed"
                      ? "Installed by Deskto. "
                      : "Linked folder. "}
                    Applies to every project in this workspace.
                    {invalidCount > 0
                      ? ` ${invalidCount} ${invalidCount === 1 ? "skill needs" : "skills need"} attention.`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => void openFolder(pack.path)}
                >
                  <FolderOpenIcon data-icon="inline-start" />
                  Open folder
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => setRemoving(pack)}
                >
                  {pack.kind === "managed" ? "Uninstall" : "Unlink"}
                </Button>
                <Switch
                  checked={attached}
                  disabled={busy !== null}
                  onCheckedChange={(checked) =>
                    void run(pack.id, () =>
                      actions.onToggle(pack.id, checked === true)
                    )
                  }
                  aria-label={`Use ${pack.name} in ${workspace.name}`}
                />
                <span className="w-8 text-xs text-muted-foreground">
                  {rowBusy ? "..." : attached ? "On" : "Off"}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removing?.kind === "managed"
                ? `Uninstall "${removing.name}"?`
                : `Unlink "${removing?.name}"?`}
            </DialogTitle>
            <DialogDescription>
              {removing?.kind === "managed"
                ? "Deskto will move its files to Trash and stop using it in every workspace."
                : "The original folder will stay on your computer. Deskto will stop using it in every workspace."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRemoving(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => {
                if (!removing) return
                const pack = removing
                const remove =
                  pack.kind === "managed"
                    ? actions.onUninstall
                    : actions.onUnlink
                void run(pack.id, () => remove(pack.id)).then(
                  (removed) => removed && setRemoving(null)
                )
              }}
            >
              {removing?.kind === "managed" ? "Move to Trash" : "Unlink"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PanelMessage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <h2 className="font-heading text-base font-medium">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}
