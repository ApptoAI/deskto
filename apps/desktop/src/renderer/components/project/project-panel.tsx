import { useMemo, useState, type ReactNode } from "react"
import EllipsisVerticalIcon from "lucide-react/dist/esm/icons/ellipsis-vertical"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import PencilIcon from "lucide-react/dist/esm/icons/pencil"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import {
  projectDescriptionMaxLength,
  projectInstructionsMaxLength,
  projectNameMaxLength,
  type Project,
  type ProjectDetails,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"

import { openFolder, pickProjectFolder } from "../../lib/desktop.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type RuntimeQuery,
} from "../../runtime/use-runtime-query.js"
import { InlineError } from "../inline-error.js"
import { SaveTemplateDialog } from "./save-template-dialog.js"

/** Which focused editor is open; the panel shows one at a time. */
type PanelDialog = "about" | "instructions" | "template" | null

/**
 * The project's settings, laid out as cards under the composer instead of
 * behind a menu: what the project is, how agents should work, where the
 * files live. Everything here edits through one small dialog per card.
 */
export function ProjectPanel({
  project,
  details,
}: {
  project: Project
  details: RuntimeQuery<ProjectDetails>
}) {
  const client = useRuntimeClient()
  const [mountedDialog, setMountedDialog] = useState<PanelDialog>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  const loadedDetails =
    details.state.status === "ready" ? details.state.data : null
  const loadError =
    details.state.status === "error" ? details.state.message : null

  const loadTemplateFiles = useMemo(
    () =>
      mountedDialog === "template"
        ? () => client.listProjectTemplateFiles(project.id)
        : null,
    [client, mountedDialog, project.id]
  )
  const templateFiles = useRuntimeQuery(loadTemplateFiles)

  function openDialog(dialog: Exclude<PanelDialog, null>) {
    setMountedDialog(dialog)
    setDialogOpen(true)
  }

  function finishDialogChange(open: boolean) {
    if (!open) setMountedDialog(null)
  }

  async function updateProject(patch: {
    name?: string
    description?: string
    instructions?: string
  }) {
    await client.updateProject({ projectId: project.id, ...patch })
    details.revalidate()
  }

  async function moveFolder() {
    setPanelError(null)
    setMoving(true)
    try {
      const picked = await pickProjectFolder()
      if (!picked) return
      await client.relocateProject(project.id, picked.path)
      details.revalidate()
    } catch (error) {
      setPanelError(describedErrorSchema.parse(error))
    } finally {
      setMoving(false)
    }
  }

  async function showFolder() {
    setPanelError(null)
    try {
      await openFolder(project.path)
    } catch (error) {
      setPanelError(describedErrorSchema.parse(error))
    }
  }

  return (
    <section
      id="project-settings-panel"
      aria-label="Project settings"
      className="enter-rise w-full space-y-3"
    >
      {panelError ? <InlineError message={panelError} /> : null}
      {loadError ? (
        <div className="space-y-2">
          <InlineError message={loadError} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={details.revalidate}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <PanelCard
          title="About"
          editLabel="Edit name and description"
          hasContent={project.description !== ""}
          onEdit={() => openDialog("about")}
        >
          {project.description ? (
            <p className="line-clamp-4 text-sm">{project.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Describe what this project is for.
            </p>
          )}
        </PanelCard>

        <PanelCard
          title="Instructions"
          editLabel="Edit project instructions"
          hasContent={
            loadedDetails !== null && loadedDetails.instructions !== ""
          }
          editDisabled={loadedDetails === null}
          onEdit={() => openDialog("instructions")}
        >
          {loadedDetails === null ? (
            <p className="text-sm text-muted-foreground">
              {loadError ? "Instructions are unavailable." : "Loading…"}
            </p>
          ) : loadedDetails.instructions ? (
            <p className="line-clamp-4 text-sm whitespace-pre-wrap">
              {loadedDetails.instructions}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tell every agent how work should be done here.
            </p>
          )}
        </PanelCard>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardAction>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-mt-0.5 -mr-1 text-muted-foreground"
                      aria-label="Project actions"
                    />
                  }
                >
                  <EllipsisVerticalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openDialog("template")}>
                    Save as template…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                {project.locationKind === "managed"
                  ? "Managed by Deskto"
                  : "Linked folder"}
              </span>
            </div>
            <p
              className="truncate font-mono text-micro text-muted-foreground"
              title={project.path}
            >
              {project.path}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void showFolder()}
              >
                Show folder
              </Button>
              {project.locationKind === "managed" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={moving}
                  onClick={() => void moveFolder()}
                >
                  {moving ? "Moving…" : "Move to folder…"}
                </Button>
              ) : null}
            </div>
            {project.locationKind === "managed" ? (
              <p className="text-xs text-muted-foreground">
                Tasks and instructions stay with the project.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {loadedDetails?.sourceTemplate ? (
        <p className="px-1 text-xs text-muted-foreground">
          Created from {loadedDetails.sourceTemplate.name} in{" "}
          {loadedDetails.sourceTemplate.packName}.
        </p>
      ) : null}

      {mountedDialog === "about" ? (
        <AboutDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onOpenChangeComplete={finishDialogChange}
          project={project}
          onSubmit={(draft) => updateProject(draft)}
        />
      ) : null}
      {mountedDialog === "instructions" ? (
        <InstructionsDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onOpenChangeComplete={finishDialogChange}
          projectName={project.name}
          instructions={loadedDetails?.instructions ?? ""}
          onSubmit={(instructions) => updateProject({ instructions })}
        />
      ) : null}
      {mountedDialog === "template" ? (
        <SaveTemplateDialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) setTemplateError(null)
          }}
          onOpenChangeComplete={finishDialogChange}
          project={project}
          files={
            templateFiles.state.status === "ready"
              ? templateFiles.state.data
              : []
          }
          loading={
            templateFiles.state.status === "idle" ||
            templateFiles.state.status === "loading"
          }
          loadError={
            templateFiles.state.status === "error"
              ? templateFiles.state.message
              : null
          }
          actionError={templateError}
          onRetry={templateFiles.revalidate}
          onSubmit={async (draft) => {
            setTemplateError(null)
            try {
              await client.saveTemplateFromProject({
                projectId: project.id,
                ...draft,
              })
            } catch (error) {
              // The dialog stays open; this is the error it shows.
              setTemplateError(describedErrorSchema.parse(error))
              throw error
            }
          }}
        />
      ) : null}
    </section>
  )
}

function PanelCard({
  title,
  editLabel,
  hasContent,
  editDisabled = false,
  onEdit,
  children,
}: {
  title: string
  editLabel: string
  hasContent: boolean
  editDisabled?: boolean
  onEdit: () => void
  children: ReactNode
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mt-0.5 -mr-1 text-muted-foreground"
            aria-label={editLabel}
            disabled={editDisabled}
            onClick={onEdit}
          >
            {hasContent ? <PencilIcon /> : <PlusIcon />}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function AboutDialog({
  open,
  onOpenChange,
  onOpenChangeComplete,
  project,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  project: Project
  onSubmit: (draft: { name: string; description: string }) => Promise<void>
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-lg">
        <AboutForm
          project={project}
          onSubmit={onSubmit}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function AboutForm({
  project,
  onSubmit,
  onClose,
}: {
  project: Project
  onSubmit: (draft: { name: string; description: string }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), description: description.trim() })
      onClose()
    } catch (submitError) {
      setError(describedErrorSchema.parse(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>About this project</DialogTitle>
        <DialogDescription>
          The description reminds everyone — including agents — what this
          project is for.
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
          <Label htmlFor="project-about-name">Name</Label>
          <Input
            id="project-about-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={projectNameMaxLength}
            disabled={busy}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-about-description">Description</Label>
          <Textarea
            id="project-about-description"
            className="min-h-24 resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={projectDescriptionMaxLength}
            disabled={busy}
            placeholder="Describe your project, goals, subject, etc..."
          />
        </div>
        {error ? <InlineError message={error} /> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function InstructionsDialog({
  open,
  onOpenChange,
  onOpenChangeComplete,
  projectName,
  instructions,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  projectName: string
  instructions: string
  onSubmit: (instructions: string) => Promise<void>
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogContent className="sm:max-w-xl">
        <InstructionsForm
          projectName={projectName}
          instructions={instructions}
          onSubmit={onSubmit}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function InstructionsForm({
  projectName,
  instructions,
  onSubmit,
  onClose,
}: {
  projectName: string
  instructions: string
  onSubmit: (instructions: string) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(instructions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(draft)
      onClose()
    } catch (submitError) {
      setError(describedErrorSchema.parse(submitError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Set project instructions</DialogTitle>
        <DialogDescription>
          Every agent working in {projectName} follows these instructions.
          Existing AGENTS.md and CLAUDE.md files remain unchanged.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Textarea
          aria-label="Project instructions"
          className="min-h-56 resize-y"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={projectInstructionsMaxLength}
          disabled={busy}
          placeholder="Describe terminology, constraints, and how work should be done."
          autoFocus
        />
        {error ? <InlineError message={error} /> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save instructions"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
