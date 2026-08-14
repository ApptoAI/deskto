import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HarnessAdapterFactory } from "@openappto/harness-sdk"
import { ScriptedHarness } from "@openappto/harness-sdk/testing"
import { afterEach, describe, expect, it } from "vitest"

import { createRuntime } from "./runtime.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("Runtime", () => {
  it("persists a resumable session and forwards an approval to its active harness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const firstHarness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({ databasePath, harnesses: [firstHarness] })

    const workspace = unwrap(
      await runtime.request({
        method: "workspace.add",
        params: { path: directory, name: "Example" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { workspaceId: workspace.id, harnessId: "claude" },
      })
    )
    const configured = unwrap(
      await runtime.request({
        method: "thread.configure",
        params: {
          threadId: thread.id,
          executionProfile: {
            modelId: "test-model",
            effort: "high",
            permissionMode: "full-access",
          },
        },
      })
    )
    expect(configured.thread.executionProfile).toEqual({
      modelId: "test-model",
      effort: "high",
      permissionMode: "full-access",
    })

    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Prepare the report" },
      })
    )
    const firstRun = firstHarness.runs[0]!
    expect(firstRun.input.executionProfile).toEqual(
      configured.thread.executionProfile
    )
    firstRun.emit({ type: "session.started", providerSessionId: "session-42" })
    firstRun.emit({ type: "message.delta", text: "Draft ready." })
    firstRun.emit({
      type: "activity.started",
      activity: {
        id: "tool-1",
        name: "Write file",
        detail: "report.md",
      },
    })
    firstRun.emit({
      type: "activity.completed",
      id: "tool-1",
      outcome: "completed",
    })
    firstRun.emit({
      type: "approval.requested",
      request: { id: "approval-1", kind: "file-change", title: "Save report" },
    })

    let runtimeApprovalId: string | undefined
    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      runtimeApprovalId = view.pendingApproval?.id
      return runtimeApprovalId !== undefined
    })
    unwrap(
      await runtime.request({
        method: "approval.resolve",
        params: {
          threadId: thread.id,
          approvalId: runtimeApprovalId!,
          decision: "approve",
        },
      })
    )
    expect(firstRun.approvals.get("approval-1")).toBe("approve")

    firstRun.emit({ type: "turn.completed" })
    firstRun.finish()
    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      return view.thread.status === "idle"
    })
    await runtime.close()

    const resumedHarness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const resumedRuntime = createRuntime({
      databasePath,
      harnesses: [resumedHarness],
    })
    const persisted = unwrap(
      await resumedRuntime.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )
    expect(persisted.messages.map((message) => message.content)).toEqual([
      "Prepare the report",
      "Draft ready.",
    ])
    expect(persisted.activities).toMatchObject([
      {
        turnId: firstRun.input.turnId,
        name: "Write file",
        detail: "report.md",
        status: "completed",
      },
    ])

    unwrap(
      await resumedRuntime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Polish it" },
      })
    )
    expect(resumedHarness.runs[0]?.input.providerSessionId).toBe("session-42")
    await resumedRuntime.close()
  })

  it("keeps a harness switched off across restarts and blocks new tasks on it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })
    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))

    const listed = unwrap(
      await runtime.request({ method: "harness.list", params: {} })
    )
    expect(listed).toMatchObject([
      { id: "claude", enabled: true, availability: { status: "available" } },
    ])
    expect(listed[0]?.checkedAt).not.toBeNull()

    // A refresh that finds nothing moved stays silent: harness.changed only
    // fires when health actually changed, not on every re-check.
    unwrap(await runtime.request({ method: "harness.refresh", params: {} }))
    expect(events).toEqual([])

    const disabled = unwrap(
      await runtime.request({
        method: "harness.setEnabled",
        params: { harnessId: "claude", enabled: false },
      })
    )
    expect(disabled[0]?.enabled).toBe(false)
    // The response already carries the new state; no event echoes it back.
    expect(events).toEqual([])

    const workspace = unwrap(
      await runtime.request({
        method: "workspace.add",
        params: { path: directory, name: "Example" },
      })
    )
    const blocked = await runtime.request({
      method: "thread.create",
      params: { workspaceId: workspace.id, harnessId: "claude" },
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe("harness-disabled")
    await runtime.close()

    const resumedRuntime = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })
    const persisted = unwrap(
      await resumedRuntime.request({ method: "harness.list", params: {} })
    )
    expect(persisted[0]?.enabled).toBe(false)
    await resumedRuntime.close()
  })

  it("remembers the last used execution profile across restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })

    const empty = unwrap(
      await runtime.request({ method: "preferences.get", params: {} })
    )
    expect(empty.lastProfile).toBeNull()

    const workspace = unwrap(
      await runtime.request({
        method: "workspace.add",
        params: { path: directory, name: "Example" },
      })
    )
    unwrap(
      await runtime.request({
        method: "thread.create",
        params: {
          workspaceId: workspace.id,
          harnessId: "claude",
          executionProfile: {
            modelId: "test-model",
            effort: "high",
            permissionMode: "full-access",
          },
        },
      })
    )
    await runtime.close()

    const resumedRuntime = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })
    const persisted = unwrap(
      await resumedRuntime.request({ method: "preferences.get", params: {} })
    )
    expect(persisted.lastProfile).toEqual({
      harnessId: "claude",
      executionProfile: {
        modelId: "test-model",
        effort: "high",
        permissionMode: "full-access",
      },
    })
    await resumedRuntime.close()
  })

  it("stores setting overrides across restarts and rejects invalid ones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({ databasePath, harnesses: [] })
    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))

    const defaults = unwrap(
      await runtime.request({ method: "settings.get", params: {} })
    )
    expect(defaults.values["keybindings.new-task"]).toBe("mod+n")
    expect(defaults.overrides).toEqual({})

    const updated = unwrap(
      await runtime.request({
        method: "settings.update",
        params: { entries: { "keybindings.new-task": "mod+shift+n" } },
      })
    )
    expect(updated.values["keybindings.new-task"]).toBe("mod+shift+n")
    expect(updated.overrides["keybindings.new-task"]).toBe("mod+shift+n")
    expect(events).toEqual(["settings.changed"])

    const invalidValue = await runtime.request({
      method: "settings.update",
      params: { entries: { "keybindings.new-task": 7 } },
    })
    expect(invalidValue.ok).toBe(false)
    if (!invalidValue.ok)
      expect(invalidValue.error.code).toBe("invalid-setting")

    const unknownKey = await runtime.request({
      method: "settings.update",
      params: { entries: { "no-such-setting": true } },
    })
    expect(unknownKey.ok).toBe(false)
    await runtime.close()

    const resumedRuntime = createRuntime({ databasePath, harnesses: [] })
    const persisted = unwrap(
      await resumedRuntime.request({ method: "settings.get", params: {} })
    )
    expect(persisted.values["keybindings.new-task"]).toBe("mod+shift+n")

    const cleared = unwrap(
      await resumedRuntime.request({
        method: "settings.update",
        params: { entries: { "keybindings.new-task": null } },
      })
    )
    expect(cleared.values["keybindings.new-task"]).toBe("mod+n")
    expect(cleared.overrides).toEqual({})
    await resumedRuntime.close()
  })

  it("cancels a turn while its harness is still starting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
    directories.push(directory)
    const harness: HarnessAdapterFactory = {
      descriptor: { id: "slow", name: "Slow harness" },
      checkAvailability: () => Promise.resolve({ status: "available" }),
      listModels: () =>
        Promise.resolve([
          {
            id: "test-model",
            name: "Test model",
            supportedEfforts: ["medium"],
            defaultEffort: "medium",
            isDefault: true,
            supportedPermissionModes: [
              "approval-required",
              "auto",
              "full-access",
            ],
          },
        ]),
      start: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("Harness start was cancelled")),
            { once: true }
          )
        }),
    }
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })
    const workspace = unwrap(
      await runtime.request({
        method: "workspace.add",
        params: { path: directory, name: "Example" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { workspaceId: workspace.id, harnessId: "slow" },
      })
    )

    const starting = runtime.request({
      method: "turn.start",
      params: { threadId: thread.id, prompt: "Prepare the report" },
    })
    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      return view.thread.status === "running"
    })

    const cancelled = unwrap(
      await runtime.request({
        method: "turn.cancel",
        params: { threadId: thread.id },
      })
    )
    expect(cancelled.thread.status).toBe("idle")
    expect(cancelled.messages.map((message) => message.content)).toEqual([
      "Prepare the report",
    ])
    expect(unwrap(await starting).thread.status).toBe("idle")
    await runtime.close()
  })
})

function unwrap<T>(
  response: { ok: true; data: T } | { ok: false; error: unknown }
): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Condition was not met")
}
