import { useCallback, useState } from "react"
import type {
  ExecutionProfile,
  Harness,
  Project,
  TurnInput,
} from "@deskto/protocol"

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

/**
 * Everything a start-a-task composer needs: which agent it will run, the
 * profile that agent was last given, and the two-step create-then-start the
 * Runtime expects.
 *
 * It lives outside the views because a project has two places to start a
 * task from — the empty screen and the task table — and a second copy of the
 * fallback rules is a second set of answers to "which agent runs this".
 */
export function useTaskComposer({
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

  async function send(input: TurnInput) {
    if (!harnessId) return

    const thread = await client.createThread(project.id, harnessId, profile)
    onTaskCreated(thread.id)
    await client.startTurn(thread.id, input)
    onTaskStarted(thread.id)
  }

  return {
    options,
    harnessId,
    selectHarness,
    models,
    profile,
    setProfile: setChosenProfile,
    blockedReason,
    modelMenuOpen,
    setModelMenuOpen,
    send,
  }
}
