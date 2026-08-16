import { useCallback, useMemo, useState } from "react"
import type {
  Pack,
  Project,
  SkillInventory,
  SkillOccurrence,
  Workspace,
} from "@deskto/protocol"
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { InlineError } from "../inline-error.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type RuntimeQuery,
} from "../../runtime/use-runtime-query.js"
import { usePackChanged } from "../../runtime/use-pack-changed.js"
import { PacksPanel, type PackActions } from "./packs-panel.js"
import { SkillDetailsDialog } from "./skill-details-dialog.js"
import { SkillList } from "./skill-list.js"
import { skillsTabOrder, skillsTabs, type SkillsTab } from "./skills-tabs.js"

export function SkillsView({
  tab,
  project,
  workspace,
  packs,
  packActions,
  onSelectTab,
}: {
  tab: SkillsTab
  project: Project | null
  workspace: Workspace | null
  packs: RuntimeQuery<Pack[]>
  packActions: PackActions
  onSelectTab: (tab: SkillsTab) => void
}) {
  const client = useRuntimeClient()
  const projectId = project?.id ?? null
  const [selection, setSelection] = useState<{
    occurrence: SkillOccurrence
    tab: SkillsTab
    projectId: string | null
  } | null>(null)
  const selected =
    selection?.tab === tab && selection.projectId === projectId
      ? selection.occurrence
      : null

  const loadProjectSkills = useMemo(
    () =>
      tab === "project" && projectId
        ? () => client.listSkillsForProject(projectId)
        : null,
    [client, projectId, tab]
  )
  const projectSkills = useRuntimeQuery(loadProjectSkills)

  const loadComputerSkills = useMemo(
    () => (tab === "computer" ? () => client.listSkillsOnComputer() : null),
    [client, tab]
  )
  const computerSkills = useRuntimeQuery(loadComputerSkills)

  const detailsProjectId = tab === "project" ? projectId : undefined
  const loadDetails = useMemo(
    () =>
      selected
        ? () => client.getSkill(selected.id, detailsProjectId ?? undefined)
        : null,
    [client, detailsProjectId, selected]
  )
  const details = useRuntimeQuery(loadDetails)

  const revalidateProjectSkills = projectSkills.revalidate
  const revalidateComputerSkills = computerSkills.revalidate
  usePackChanged(
    useCallback(() => {
      revalidateProjectSkills()
      revalidateComputerSkills()
    }, [revalidateComputerSkills, revalidateProjectSkills])
  )

  const inventory =
    tab === "project"
      ? projectSkills
      : tab === "computer"
        ? computerSkills
        : null
  const readyInventory =
    inventory?.state.status === "ready" ? inventory.state.data : null
  const selectedSource = selected
    ? readyInventory?.sources.find((source) => source.id === selected.sourceId)
    : undefined

  function selectTab(nextTab: SkillsTab) {
    setSelection(null)
    onSelectTab(nextTab)
  }

  function selectOccurrence(occurrence: SkillOccurrence) {
    setSelection({ occurrence, tab, projectId })
  }

  function moveTabFocus(currentTab: SkillsTab, direction: -1 | 1) {
    const currentIndex = skillsTabOrder.indexOf(currentTab)
    const nextIndex =
      (currentIndex + direction + skillsTabOrder.length) % skillsTabOrder.length
    const nextTab = skillsTabOrder[nextIndex]!
    selectTab(nextTab)
    document.getElementById(`skills-tab-${nextTab}`)?.focus()
  }

  return (
    <>
      <header className="drag-region h-10 shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl font-medium">Skills</h1>
              <p className="pt-1 text-sm text-muted-foreground">
                See which instructions your agents can find and manage shared
                Packs.
              </p>
            </div>
            {inventory ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={inventory.revalidate}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Refresh
              </Button>
            ) : null}
          </div>

          <div
            role="tablist"
            aria-label="Skills"
            className="mt-6 flex gap-1 border-b border-border"
          >
            {skillsTabOrder.map((id) => (
              <button
                key={id}
                id={`skills-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={id === tab}
                aria-controls={`skills-panel-${id}`}
                tabIndex={id === tab ? 0 : -1}
                onClick={() => selectTab(id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault()
                    moveTabFocus(id, -1)
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault()
                    moveTabFocus(id, 1)
                  } else if (event.key === "Home") {
                    event.preventDefault()
                    selectTab(skillsTabOrder[0]!)
                    document
                      .getElementById(`skills-tab-${skillsTabOrder[0]!}`)
                      ?.focus()
                  } else if (event.key === "End") {
                    event.preventDefault()
                    const lastTab = skillsTabOrder.at(-1)!
                    selectTab(lastTab)
                    document.getElementById(`skills-tab-${lastTab}`)?.focus()
                  }
                }}
                className={cn(
                  "no-drag -mb-px border-b-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:rounded-t-md focus-visible:ring-2 focus-visible:ring-ring/50",
                  id === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {skillsTabs[id].label}
              </button>
            ))}
          </div>

          <section
            id={`skills-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`skills-tab-${tab}`}
            className="pt-5"
          >
            <p className="mb-4 text-sm text-muted-foreground">
              {skillsTabs[tab].description}
            </p>
            {tab === "packs" ? (
              <PacksPanel
                workspace={workspace}
                packs={packs}
                actions={packActions}
              />
            ) : tab === "project" && !project ? (
              <InventoryMessage
                title="Open a project to see its skills"
                description="You can still browse skills on this computer or manage Packs."
              />
            ) : inventory ? (
              <InventoryPanel query={inventory} onSelect={selectOccurrence} />
            ) : null}
          </section>
        </div>
      </div>

      <SkillDetailsDialog
        key={selected?.id ?? "none"}
        open={selected !== null}
        state={details.state}
        source={selectedSource}
        onClose={() => setSelection(null)}
        onRetry={details.revalidate}
        onUpdateManaged={async (packId, directoryName, draft) => {
          await client.updateManagedSkill(packId, directoryName, draft)
          details.revalidate()
          projectSkills.revalidate()
        }}
      />
    </>
  )
}

function InventoryPanel({
  query,
  onSelect,
}: {
  query: RuntimeQuery<SkillInventory>
  onSelect: (occurrence: SkillOccurrence) => void
}) {
  if (query.state.status === "loading" || query.state.status === "idle") {
    return <InventoryMessage title="Checking skill folders..." />
  }
  if (query.state.status === "error") {
    return (
      <div className="space-y-3">
        <InlineError message={query.state.message} />
        <Button type="button" variant="outline" onClick={query.revalidate}>
          Try again
        </Button>
      </div>
    )
  }
  return <SkillList inventory={query.state.data} onSelect={onSelect} />
}

function InventoryMessage({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <h2 className="font-heading text-base font-medium">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
