import { useCallback, useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import ChevronUpIcon from "lucide-react/dist/esm/icons/chevron-up"
import SettingsIcon from "lucide-react/dist/esm/icons/settings"
import type {
  ExecutionProfile,
  Harness,
  Project,
  TurnInput,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

import { executionProfileForHarness } from "../../lib/execution-profile.js"
import {
  describeHarnessBlock,
  findHarness,
  isHarnessAvailable,
} from "../../lib/harness.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import {
  useRuntimeQuery,
  type QueryState,
} from "../../runtime/use-runtime-query.js"
import { Composer } from "../composer.js"
import { ExecutionProfileToolbar } from "../execution-profile/execution-profile-toolbar.js"
import { HarnessMenu } from "../harness-menu.js"
import { ProjectPanel } from "../project/project-panel.js"

/** How the project panel should show up before the user has chosen. */
export type ProjectPanelPreference = "open" | "collapsed" | "auto"

export function NewTaskView({
  project,
  harnesses,
  onTaskCreated,
  onTaskStarted,
  panelPreference,
  onPanelCollapsedChange,
}: {
  project: Project
  harnesses: QueryState<Harness[]>
  onTaskCreated: (threadId: string) => void
  onTaskStarted: (threadId: string) => void
  panelPreference: ProjectPanelPreference
  onPanelCollapsedChange: (collapsed: boolean) => void
}) {
  const client = useRuntimeClient()
  const [chosenHarnessId, setChosenHarnessId] = useState<string | null>(null)
  const [chosenProfile, setChosenProfile] = useState<ExecutionProfile | null>(
    null
  )
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const loadPreferences = useCallback(
    () => client.getPreferences(project.workspaceId),
    [client, project.workspaceId]
  )
  const preferences = useRuntimeQuery(loadPreferences)

  const loadDetails = useCallback(
    () => client.getProject(project.id),
    [client, project.id]
  )
  const details = useRuntimeQuery(loadDetails)
  // A fresh project opens with its panel out: the cards are the onboarding.
  // Once instructions exist — or the user closed it once — the screen stays
  // the bare composer until they ask for the panel again. The decision
  // latches on the first loaded details so saving instructions doesn't
  // yank the panel away mid-edit.
  const [autoOpen, setAutoOpen] = useState<boolean | null>(null)
  if (details.state.status === "ready" && autoOpen === null) {
    setAutoOpen(details.state.data.instructions === "")
  }
  const panelVisible =
    panelPreference === "open" ||
    (panelPreference === "auto" && autoOpen === true)
  const lastProfile =
    preferences.state.status === "ready"
      ? preferences.state.data.lastProfile
      : null
  const profilesByHarness =
    preferences.state.status === "ready"
      ? preferences.state.data.profilesByHarness
      : {}

  const options = harnesses.status === "ready" ? harnesses.data : []
  const lastHarness = lastProfile
    ? findHarness(options, lastProfile.harnessId)
    : null
  const fallbackHarnessId =
    (lastHarness && isHarnessAvailable(lastHarness) ? lastHarness.id : null) ??
    options.find(isHarnessAvailable)?.id ??
    null
  const harnessId = chosenHarnessId ?? fallbackHarnessId
  const blockedReason = describeHarnessBlock(harnesses, harnessId)

  const models = harnessId
    ? (findHarness(options, harnessId)?.models ?? [])
    : []
  const profile =
    chosenProfile ??
    executionProfileForHarness(models, harnessId, profilesByHarness)

  function selectHarness(id: string) {
    setChosenHarnessId(id)
    setChosenProfile(null)
  }

  async function handleSend(input: TurnInput) {
    if (!harnessId) return

    const thread = await client.createThread(project.id, harnessId, profile)
    onTaskCreated(thread.id)
    await client.startTurn(thread.id, input)
    onTaskStarted(thread.id)
  }

  return (
    <>
      {/* The whole start screen sits as one centered column: the question and
          the composer right under it. Pinning the input to
          the bottom made the empty view read as a half-loaded task. Auto
          margins center short content without forcing an empty scrollbar;
          expanded project settings can still grow and scroll. */}
      <div className="relative flex min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="m-auto flex w-full justify-center">
          <div
            data-slot="new-task-content"
            className="enter-rise flex w-full max-w-[700px] flex-col items-center gap-5"
          >
            {/* The one display moment in the app. Size and tight tracking
                carry it; there is nothing to bold against on an empty
                screen. */}
            <p className="text-center display-sm text-body">
              What should we do next in{" "}
              <span className="text-foreground">{project.name}</span>?
            </p>

            <div className="w-full max-w-[700px]">
              <Composer
                projectId={project.id}
                harnessId={harnessId}
                label="What should the agent do?"
                placeholder="Describe the task"
                onSend={handleSend}
                blockedReason={blockedReason}
                {...(models.length > 0
                  ? { onOpenModelPicker: () => setModelMenuOpen(true) }
                  : {})}
                autoFocus
                toolbar={
                  options.length > 0 ? (
                    <>
                      <HarnessMenu
                        harnesses={options}
                        selectedId={harnessId}
                        onSelect={selectHarness}
                        compact
                      />
                      <ExecutionProfileToolbar
                        models={models}
                        profile={profile}
                        onChange={setChosenProfile}
                        modelMenuOpen={modelMenuOpen}
                        onModelMenuOpenChange={setModelMenuOpen}
                      />
                    </>
                  ) : null
                }
              />
            </div>

            {/* Settings share the composer's outer edge; cards still open
                beneath it. */}
            <div className="flex w-full max-w-[700px] justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted"
                aria-expanded={panelVisible}
                aria-controls="project-settings-panel"
                onClick={() => onPanelCollapsedChange(panelVisible)}
              >
                <SettingsIcon data-icon="inline-start" />
                Project settings
                {panelVisible ? (
                  <ChevronUpIcon data-icon="inline-end" />
                ) : (
                  <ChevronDownIcon data-icon="inline-end" />
                )}
              </Button>
            </div>

            {panelVisible ? (
              <ProjectPanel project={project} details={details} />
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
