import { useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import ChevronRightIcon from "lucide-react/dist/esm/icons/chevron-right"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  projectDescriptionMaxLength,
  projectNameMaxLength,
  type ProjectTemplate,
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
import { cn } from "@workspace/ui/lib/utils"

import { InlineError } from "../inline-error.js"

export type ProjectDraft = {
  name: string
  description: string
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
  const [description, setDescription] = useState("")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [templateId, setTemplateId] = useState("")
  const templateInventoryKey = templatesLoading
    ? null
    : templates.map((template) => template.id).join("\0")
  const [knownTemplateInventoryKey, setKnownTemplateInventoryKey] = useState(
    templateInventoryKey
  )
  if (
    templateInventoryKey !== null &&
    templateInventoryKey !== knownTemplateInventoryKey
  ) {
    setKnownTemplateInventoryKey(templateInventoryKey)
    if (
      templateId &&
      !templates.some((template) => template.id === templateId)
    ) {
      setTemplateId("")
    }
  }
  const [locationKind, setLocationKind] = useState<"managed" | "linked">(
    "managed"
  )
  const [folder, setFolder] = useState<PickedFolder | null>(null)
  const selectedTemplate =
    templates.find((template) => template.id === templateId) ?? null
  const collapsedSummary = [
    selectedTemplate ? `Template: ${selectedTemplate.name}` : null,
    locationKind === "linked" && folder ? `Folder: ${folder.path}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

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
        description: description.trim(),
        location,
        ...(selectedTemplate ? { templateId: selectedTemplate.id } : undefined),
      })
    } catch {
      // The workbench shows the Runtime error and keeps this draft open.
    }
  }

  const AdvancedChevron = advancedOpen ? ChevronDownIcon : ChevronRightIcon

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create a project</DialogTitle>
        <DialogDescription>
          A project keeps related tasks, files, and instructions together.
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
          <Label htmlFor="project-name">What are you working on?</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name your project"
            maxLength={projectNameMaxLength}
            disabled={busy}
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-description">
            What are you trying to achieve?
          </Label>
          <Textarea
            id="project-description"
            className="min-h-20 resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe the project, its goals, and relevant context…"
            maxLength={projectDescriptionMaxLength}
            disabled={busy}
          />
        </div>

        {/* Deskto manages the folder unless someone asks otherwise, so the
            filesystem question stays folded away from first-time users. */}
        <Collapsible
          className="space-y-3"
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <div className="flex min-w-0 items-center gap-2">
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors duration-120 outline-none hover:text-foreground focus-visible:text-foreground"
                />
              }
            >
              <AdvancedChevron className="size-3.5" />
              Advanced
            </CollapsibleTrigger>
            {/* Folding the section must not hide what it changed: a chosen
                template or linked folder stays summarized on the fold line. */}
            {!advancedOpen && collapsedSummary ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {collapsedSummary}
              </span>
            ) : null}
          </div>

          <CollapsibleContent>
            <div className="space-y-5 pt-px">
              {templatesLoading || templates.length > 0 ? (
                <div className="space-y-2">
                  <Label id="project-template-label">Template</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-between font-normal"
                          aria-labelledby="project-template-label"
                          disabled={busy || templatesLoading}
                        />
                      }
                    >
                      <span className="min-w-0 truncate">
                        {templatesLoading
                          ? "Loading templates…"
                          : (selectedTemplate?.name ?? "Blank project")}
                      </span>
                      <ChevronDownIcon
                        data-icon="inline-end"
                        className="text-muted-foreground"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup
                        value={selectedTemplate?.id ?? ""}
                        onValueChange={(value) => setTemplateId(String(value))}
                      >
                        <DropdownMenuRadioItem value="" closeOnClick>
                          Blank project
                        </DropdownMenuRadioItem>
                        {templates.map((template) => (
                          <DropdownMenuRadioItem
                            key={template.id}
                            value={template.id}
                            closeOnClick
                          >
                            <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                              <span className="truncate">{template.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {template.packName}
                              </span>
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {selectedTemplate?.description ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedTemplate.description}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Location</legend>
                <div
                  role="radiogroup"
                  aria-label="Project location"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={locationKind === "managed"}
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
                    role="radio"
                    aria-checked={locationKind === "linked"}
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
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* The template list failing must stay visible with Advanced folded,
            or "Blank project" quietly becomes the only choice. */}
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
      ? "border-input bg-muted"
      : "border-border hover:border-muted-foreground"
  )
}
