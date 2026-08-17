import { useCallback, useState } from "react"
import type {
  ExecutionProfile,
  Harness,
  Project,
  TurnInput,
} from "@deskto/protocol"

import {
  defaultExecutionProfile,
  restoredExecutionProfile,
} from "../../lib/execution-profile.js"
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

export function NewTaskView({
  project,
  harnesses,
  onTaskCreated,
  onTaskStarted,
}: {
  project: Project
  harnesses: QueryState<Harness[]>
  onTaskCreated: (threadId: string) => void
  onTaskStarted: (threadId: string) => void
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
  const lastProfile =
    preferences.state.status === "ready"
      ? preferences.state.data.lastProfile
      : null

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
    (lastProfile && lastProfile.harnessId === harnessId
      ? restoredExecutionProfile(models, lastProfile.executionProfile)
      : defaultExecutionProfile(models))

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
      <header className="drag-region h-10 shrink-0" />

      {/* The whole start screen sits as one centered column: wordmark, the
          question, and the composer right under them. Pinning the input to
          the bottom made the empty view read as a half-loaded task. The
          negative top margin offsets the drag strip above, so the column
          lands on the optical centre of the window rather than 40px below. */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="enter-rise -mt-10 flex w-full max-w-3xl flex-col items-center gap-4">
          <div
            aria-hidden
            className="font-heading text-6xl leading-none font-normal tracking-[-0.04em] text-foreground/8 select-none sm:text-7xl"
          >
            deskto
          </div>

          {/* The one display moment in the app. Size and tight tracking carry
              it; there is nothing to bold against on an empty screen. */}
          <p className="text-center display-sm text-body">
            What should we do next in{" "}
            <span className="text-foreground">{project.name}</span>?
          </p>

          <div className="w-full">
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
                    />
                    <ExecutionProfileToolbar
                      models={models}
                      profile={profile}
                      onChange={setChosenProfile}
                      harnessId={harnessId}
                      modelMenuOpen={modelMenuOpen}
                      onModelMenuOpenChange={setModelMenuOpen}
                    />
                  </>
                ) : null
              }
            />
          </div>
        </div>
      </div>
    </>
  )
}
