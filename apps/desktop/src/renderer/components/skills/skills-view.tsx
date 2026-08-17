import { useCallback, useMemo, useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import FileArchiveIcon from "lucide-react/dist/esm/icons/file-archive"
import FolderInputIcon from "lucide-react/dist/esm/icons/folder-input"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw"
import SearchIcon from "lucide-react/dist/esm/icons/search"
import type {
  ManagedSkillDraft,
  Pack,
  Project,
  SkillInventory,
  Workspace,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"

import { InlineError } from "../inline-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type RuntimeQuery,
} from "../../runtime/use-runtime-query.js"
import { usePackChanged } from "../../runtime/use-pack-changed.js"
import { CreateSkillDialog } from "./create-skill-dialog.js"
import {
  buildSkillCatalog,
  resolveSkillCatalogItem,
  type CatalogOccurrence,
  type SkillCatalogItem,
  type SkillCatalogSelection,
} from "./skill-catalog.js"
import { SkillDetailsPanel } from "./skill-details-panel.js"
import { SkillList } from "./skill-list.js"
import {
  isSkillsFilter,
  skillsFilterOrder,
  skillsFilters,
  type SkillsFilter,
} from "./skills-filters.js"
import { PacksPanel, type PackActions } from "./packs-panel.js"

export function SkillsView({
  filter,
  project,
  workspace,
  packs,
  packActions,
  onCreateSkill,
  onSelectFilter,
}: {
  filter: SkillsFilter
  project: Project | null
  workspace: Workspace | null
  packs: RuntimeQuery<Pack[]>
  packActions: PackActions
  onCreateSkill: (draft: ManagedSkillDraft) => Promise<void>
  onSelectFilter: (filter: SkillsFilter) => void
}) {
  const client = useRuntimeClient()
  const projectId = project?.id ?? null
  const workspaceId = workspace?.id ?? null
  const [query, setQuery] = useState("")
  const [selection, setSelection] = useState<SkillCatalogSelection | null>(null)
  const [creatingSkill, setCreatingSkill] = useState(false)
  const [managingPacks, setManagingPacks] = useState(false)
  const [runningAction, setRunningAction] = useState<string | null>(null)

  const loadInventory = useMemo(
    () =>
      projectId
        ? () => client.listSkillsForProject(projectId)
        : workspaceId
          ? () => client.listSkillsForWorkspace(workspaceId)
          : () => client.listSkillsOnComputer(),
    [client, projectId, workspaceId]
  )
  const inventory = useRuntimeQuery(loadInventory)
  const inventoryData =
    inventory.state.status === "ready" ? inventory.state.data : null
  const effectiveFilter =
    (filter === "project" && !project) ||
    (filter === "workspace" && !workspace)
      ? "all"
      : filter
  const items = useMemo(
    () =>
      inventoryData
        ? buildSkillCatalog(inventoryData, effectiveFilter, query)
        : [],
    [inventoryData, effectiveFilter, query]
  )
  const selectedItem = resolveSkillCatalogItem(items, selection)
  const selectedOccurrence = selectedItem
    ? (selectedItem.occurrences.find(
        ({ occurrence }) => occurrence.id === selection?.occurrenceId
      ) ?? selectedItem.primary)
    : null
  const selectedOccurrenceId = selectedOccurrence?.occurrence.id ?? null

  const loadDetails = useMemo(
    () =>
      selectedOccurrenceId
        ? () =>
            client.getSkill(
              selectedOccurrenceId,
              projectId
                ? { projectId }
                : workspaceId
                  ? { workspaceId }
                  : undefined
            )
        : null,
    [client, projectId, selectedOccurrenceId, workspaceId]
  )
  const details = useRuntimeQuery(loadDetails)

  const revalidateInventory = inventory.revalidate
  usePackChanged(
    useCallback(() => revalidateInventory(), [revalidateInventory])
  )

  function selectItem(item: SkillCatalogItem) {
    setSelection({
      itemKey: item.key,
      occurrenceId: item.primary.occurrence.id,
    })
  }

  function selectOccurrence(occurrence: CatalogOccurrence) {
    if (!selectedItem) return
    setSelection({
      itemKey: selectedItem.key,
      occurrenceId: occurrence.occurrence.id,
    })
  }

  async function runAction(key: string, action: () => Promise<void>) {
    setRunningAction(key)
    try {
      await action()
    } catch {
      // Workbench shows mutation failures in its error strip.
    } finally {
      setRunningAction(null)
    }
  }

  return (
    <>
      <header className="drag-region h-10 shrink-0" />
      <div className="min-h-0 flex-1 px-5 pb-5">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 pb-5">
            <div>
              <h1 className="font-heading display-sm">Skills</h1>
              <p className="pt-1 text-sm text-muted-foreground">
                Instructions your agents can use for repeatable work.
              </p>
            </div>
            <div className="no-drag flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setManagingPacks(true)}
              >
                Manage Packs
              </Button>
              <AddSkillMenu
                disabled={!workspace || runningAction !== null}
                onCreate={() => setCreatingSkill(true)}
                onInstallFolder={() =>
                  void runAction("install-folder", packActions.onInstallFolder)
                }
                onInstallZip={() =>
                  void runAction("install-zip", packActions.onInstallZip)
                }
                onLink={() => void runAction("link", packActions.onLink)}
              />
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-background">
            <aside className="flex min-h-0 flex-col border-r border-border bg-chrome/45">
              <div className="space-y-2 border-b border-border p-3">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search skills..."
                    aria-label="Search skills"
                    className="bg-background pl-8"
                  />
                </div>
                <SkillsFilterMenu
                  value={effectiveFilter}
                  projectAvailable={project !== null}
                  workspaceAvailable={workspace !== null}
                  onChange={onSelectFilter}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <CatalogContent
                  inventory={inventory}
                  items={items}
                  selectedKey={selectedItem?.key ?? null}
                  filter={effectiveFilter}
                  query={query}
                  onSelect={selectItem}
                />
              </div>
              <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                <span>
                  {items.length === 1 ? "1 skill" : `${items.length} skills`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refresh skills"
                  onClick={() => {
                    inventory.revalidate()
                    details.revalidate()
                  }}
                >
                  <RefreshCwIcon />
                </Button>
              </div>
            </aside>

            <section className="min-h-0 overflow-y-auto">
              {selectedItem && selectedOccurrence ? (
                <SkillDetailsPanel
                  key={selectedOccurrence.occurrence.id}
                  item={selectedItem}
                  selected={selectedOccurrence}
                  state={details.state}
                  onSelectOccurrence={selectOccurrence}
                  onRetry={details.revalidate}
                  onUpdateManaged={async (packId, directoryName, draft) => {
                    await client.updateManagedSkill(
                      packId,
                      directoryName,
                      draft
                    )
                    details.revalidate()
                    inventory.revalidate()
                  }}
                />
              ) : inventory.state.status === "ready" ? (
                <EmptyDetails />
              ) : null}
            </section>
          </div>
        </div>
      </div>

      <CreateSkillDialog
        open={creatingSkill}
        onOpenChange={setCreatingSkill}
        onCreate={onCreateSkill}
      />
      <PackSourcesDialog
        open={managingPacks}
        onOpenChange={setManagingPacks}
        workspace={workspace}
        packs={packs}
        actions={packActions}
      />
    </>
  )
}

function CatalogContent({
  inventory,
  items,
  selectedKey,
  filter,
  query,
  onSelect,
}: {
  inventory: RuntimeQuery<SkillInventory>
  items: SkillCatalogItem[]
  selectedKey: string | null
  filter: SkillsFilter
  query: string
  onSelect: (item: SkillCatalogItem) => void
}) {
  if (
    inventory.state.status === "loading" ||
    inventory.state.status === "idle"
  ) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        Checking skill folders...
      </p>
    )
  }
  if (inventory.state.status === "error") {
    return (
      <div className="space-y-3 p-3">
        <InlineError message={inventory.state.message} />
        <Button type="button" variant="outline" onClick={inventory.revalidate}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <SkillList
      inventory={inventory.state.data}
      items={items}
      selectedKey={selectedKey}
      filter={filter}
      query={query}
      onSelect={onSelect}
    />
  )
}

function SkillsFilterMenu({
  value,
  projectAvailable,
  workspaceAvailable,
  onChange,
}: {
  value: SkillsFilter
  projectAvailable: boolean
  workspaceAvailable: boolean
  onChange: (filter: SkillsFilter) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between bg-background font-normal"
          />
        }
      >
        {skillsFilters[value].label}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-(--anchor-width)">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => {
            const filter = String(nextValue)
            if (isSkillsFilter(filter)) onChange(filter)
          }}
        >
          {skillsFilterOrder.map((filter) => (
            <DropdownMenuRadioItem
              key={filter}
              value={filter}
              disabled={
                (filter === "project" && !projectAvailable) ||
                (filter === "workspace" && !workspaceAvailable)
              }
              closeOnClick
            >
              <span className="flex min-w-0 flex-col py-0.5">
                <span>{skillsFilters[filter].label}</span>
                <span className="text-xs leading-snug text-muted-foreground">
                  {skillsFilters[filter].description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddSkillMenu({
  disabled,
  onCreate,
  onInstallFolder,
  onInstallZip,
  onLink,
}: {
  disabled: boolean
  onCreate: () => void
  onInstallFolder: () => void
  onInstallZip: () => void
  onLink: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" disabled={disabled} />}
      >
        <PlusIcon data-icon="inline-start" />
        Add
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onCreate}>
          <PlusIcon />
          Create skill
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onInstallFolder}>
          <FolderInputIcon />
          Install Pack from folder
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onInstallZip}>
          <FileArchiveIcon />
          Install Pack ZIP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onLink}>
          <FolderInputIcon />
          Link Pack folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PackSourcesDialog({
  open,
  onOpenChange,
  workspace,
  packs,
  actions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
  packs: RuntimeQuery<Pack[]>
  actions: PackActions
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(46rem,calc(100%-2rem))] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Manage Packs</DialogTitle>
          <DialogDescription>
            Packs are skill folders shared by every project in this workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          <PacksPanel workspace={workspace} packs={packs} actions={actions} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmptyDetails() {
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
      <p className="text-sm font-medium">Choose a skill</p>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Select a skill to read its instructions, see where it came from, and
        check which agents can find it.
      </p>
    </div>
  )
}
