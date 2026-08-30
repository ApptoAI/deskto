import type { useTaskComposer } from "./use-task-composer.js"
import { ExecutionProfileToolbar } from "../execution-profile/execution-profile-toolbar.js"
import { HarnessMenu } from "../harness-menu.js"

/**
 * The four decisions a task carries — agent, model, thinking, permissions —
 * in the order they narrow each other. Shown wherever a task can be started
 * so the row means the same thing on the empty screen and under the table.
 */
export function TaskComposerToolbar({
  composer,
}: {
  composer: ReturnType<typeof useTaskComposer>
}) {
  if (composer.options.length === 0) return null

  return (
    <>
      <HarnessMenu
        harnesses={composer.options}
        selectedId={composer.harnessId}
        onSelect={composer.selectHarness}
      />
      <ExecutionProfileToolbar
        models={composer.models}
        profile={composer.profile}
        onChange={composer.setProfile}
        harnessId={composer.harnessId}
        modelMenuOpen={composer.modelMenuOpen}
        onModelMenuOpenChange={composer.setModelMenuOpen}
      />
    </>
  )
}
