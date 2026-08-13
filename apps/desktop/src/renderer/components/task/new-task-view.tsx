import { useState } from "react"
import type {
  ExecutionProfile,
  HarnessDescriptor,
  Workspace,
} from "@openappto/protocol"

import { defaultExecutionProfile } from "../../lib/execution-profile.js"
import {
  describeHarnessBlock,
  findHarness,
  isHarnessAvailable,
} from "../../lib/harness.js"
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"
import { Composer } from "../composer.js"
import { ExecutionProfileToolbar } from "../execution-profile/execution-profile-toolbar.js"
import { HarnessMenu } from "../harness-menu.js"

export function NewTaskView({
  workspace,
  harnesses,
  onTaskCreated,
  onTaskStarted,
}: {
  workspace: Workspace
  harnesses: QueryState<HarnessDescriptor[]>
  onTaskCreated: (threadId: string) => void
  onTaskStarted: (threadId: string) => void
}) {
  const client = useRuntimeClient()
  const [chosenHarnessId, setChosenHarnessId] = useState<string | null>(null)
  const [chosenProfile, setChosenProfile] = useState<ExecutionProfile | null>(
    null
  )

  const options = harnesses.status === "ready" ? harnesses.data : []
  const fallbackHarnessId = options.find(isHarnessAvailable)?.id ?? null
  const harnessId = chosenHarnessId ?? fallbackHarnessId
  const blockedReason = describeHarnessBlock(harnesses, harnessId)

  const models = harnessId
    ? (findHarness(options, harnessId)?.models ?? [])
    : []
  const profile = chosenProfile ?? defaultExecutionProfile(models)

  function selectHarness(id: string) {
    setChosenHarnessId(id)
    setChosenProfile(null)
  }

  async function handleSend(prompt: string) {
    if (!harnessId) return

    const thread = await client.createThread(workspace.id, harnessId, profile)
    onTaskCreated(thread.id)
    await client.startTurn(thread.id, prompt)
    onTaskStarted(thread.id)
  }

  return (
    <>
      <header className="drag-region h-10 shrink-0" />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="font-heading text-2xl font-medium">
          What should we work on?
        </h1>
        <p className="text-sm text-muted-foreground">
          The agent reads and changes files in {workspace.name}.
        </p>
      </div>

      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            label="What should the agent do?"
            placeholder="Describe the task"
            onSend={handleSend}
            blockedReason={blockedReason}
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
                  />
                </>
              ) : null
            }
          />
        </div>
      </div>
    </>
  )
}
