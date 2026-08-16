import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  harnessFailure,
  type HarnessAdapterFactory,
  type TextGenerationInput,
} from "@deskto/harness-sdk"
import { ScriptedHarness } from "@deskto/harness-sdk/testing"
import { afterEach, describe, expect, it } from "vitest"

import { existingSkillRoots } from "./packs/pack-files.js"
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
  it("generates the first Thread title with the configured model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const mainHarness = new ScriptedHarness({ id: "main", name: "Main" })
    const writer = recordingTitleHarness({
      id: "writer",
      modelId: "writer-model",
      generate: () => Promise.resolve('  "Prepare quarterly report"  '),
    })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [mainHarness, writer.factory],
    })
    unwrap(
      await runtime.request({
        method: "settings.update",
        params: {
          entries: {
            "models.thread-title": {
              harnessId: "writer",
              modelId: "writer-model",
            },
          },
        },
      })
    )
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "main" },
      })
    )

    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Prepare the quarterly report" },
      })
    )

    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      return view.thread.title === "Prepare quarterly report"
    })
    expect(writer.inputs).toMatchObject([
      {
        executionProfile: {
          modelId: "writer-model",
          effort: null,
          permissionMode: "approval-required",
        },
      },
    ])
    expect(writer.inputs[0]?.prompt).toContain("Prepare the quarterly report")
    await runtime.close()
  })

  it("uses the task model for title generation by default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const harness = recordingTitleHarness({
      id: "main",
      modelId: "test-model",
      supportedEfforts: ["high"],
      generate: () => Promise.resolve("Prepare quarterly report"),
    })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness.factory],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: {
          projectId: project.id,
          harnessId: "main",
          executionProfile: {
            modelId: "test-model",
            effort: "high",
            permissionMode: "full-access",
          },
        },
      })
    )

    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Prepare the quarterly report" },
      })
    )
    await waitFor(async () => harness.inputs.length === 1)

    expect(harness.inputs[0]?.executionProfile).toEqual({
      modelId: "test-model",
      effort: null,
      permissionMode: "approval-required",
    })
    await runtime.close()
  })

  it("does not replace an explicit title model when it fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const main = recordingTitleHarness({
      id: "main",
      modelId: "main-model",
      generate: () => Promise.resolve("Unexpected fallback title"),
    })
    const writer = recordingTitleHarness({
      id: "writer",
      modelId: "writer-model",
      generate: () => Promise.reject(new Error("Writer unavailable")),
    })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [main.factory, writer.factory],
    })
    unwrap(
      await runtime.request({
        method: "settings.update",
        params: {
          entries: {
            "models.thread-title": {
              harnessId: "writer",
              modelId: "writer-model",
            },
          },
        },
      })
    )
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "main" },
      })
    )

    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Prepare the quarterly report" },
      })
    )
    await waitFor(async () => writer.inputs.length === 1)
    await runtime.close()

    const reopened = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [main.factory, writer.factory],
    })
    const view = unwrap(
      await reopened.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )
    expect(view.thread.title).toBe("New task")
    expect(main.inputs).toEqual([])
    await reopened.close()
  })

  it("persists a provider-neutral usage limit in the thread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const harness = new ScriptedHarness({ id: "future", name: "Future" })
    const runtime = createRuntime({ databasePath, harnesses: [harness] })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "future" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Continue" },
      })
    )

    harness.runs[0]?.emit({
      type: "turn.failed",
      failure: {
        kind: "usage-limit",
        message: "You've hit your session limit",
        resetAt: "2026-08-14T16:30:00.000Z",
      },
    })
    harness.runs[0]?.finish()

    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      return view.thread.status === "failed"
    })
    await runtime.close()

    const reopened = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "future", name: "Future" })],
    })
    const persisted = unwrap(
      await reopened.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )
    expect(persisted.messages.at(-1)?.failure).toEqual({
      kind: "usage-limit",
      message: "You've hit your session limit",
      resetAt: "2026-08-14T16:30:00.000Z",
    })
    await reopened.close()
  })

  it("classifies Codex and Claude Code limit messages alike", () => {
    expect(
      harnessFailure(
        "You've hit your session limit · resets 6:30pm (Europe/Warsaw)"
      ).kind
    ).toBe("usage-limit")
    expect(harnessFailure("Claude usage limit reached").kind).toBe(
      "usage-limit"
    )
    expect(harnessFailure("rate_limit_exceeded").kind).toBe("usage-limit")
    expect(harnessFailure("Rate  Limit\nwas hit").kind).toBe("usage-limit")
    expect(harnessFailure("Could not parse rate-limit response").kind).toBe(
      "error"
    )
    expect(harnessFailure("Provider process exited").kind).toBe("error")
  })

  it("stamps inbox facts and guards organization commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const created = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )

    const pinned = unwrap(
      await runtime.request({
        method: "thread.setPinned",
        params: { threadId: created.id, pinned: true },
      })
    )
    expect(pinned.pinnedAt).not.toBeNull()

    const snoozed = unwrap(
      await runtime.request({
        method: "thread.snooze",
        params: { threadId: created.id, until: "2027-01-01T09:00:00.000Z" },
      })
    )
    expect(snoozed.snoozedUntil).toBe("2027-01-01T09:00:00.000Z")
    expect(snoozed.snoozedAt).not.toBeNull()

    // Closing wins over pin and snooze: both clear so the task cannot sit
    // above the inbox or come back from a snooze after the user closed it.
    const closed = unwrap(
      await runtime.request({
        method: "thread.setDone",
        params: { threadId: created.id, done: true },
      })
    )
    expect(closed.doneOverride).toBe("done")
    expect(closed.doneAt).not.toBeNull()
    expect(closed.pinnedAt).toBeNull()
    expect(closed.snoozedUntil).toBeNull()

    const restored = unwrap(
      await runtime.request({
        method: "thread.setDone",
        params: { threadId: created.id, done: false },
      })
    )
    expect(restored.doneOverride).toBe("active")

    const restoredAndPinned = unwrap(
      await runtime.request({
        method: "thread.setPinned",
        params: { threadId: created.id, pinned: true },
      })
    )
    expect(restoredAndPinned.doneOverride).toBe("active")

    const restoredAndUnpinned = unwrap(
      await runtime.request({
        method: "thread.setPinned",
        params: { threadId: created.id, pinned: false },
      })
    )
    expect(restoredAndUnpinned.doneOverride).toBe("active")

    unwrap(
      await runtime.request({
        method: "thread.snooze",
        params: { threadId: created.id, until: "2027-01-01T09:00:00.000Z" },
      })
    )
    const started = unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: created.id, prompt: "Summarize the folder" },
      })
    )
    // A new turn is real activity: the override and the snooze cleared and
    // the message time stamped, so the task is back in the inbox, visible.
    expect(started.thread.doneOverride).toBeNull()
    expect(started.thread.snoozedUntil).toBeNull()
    expect(started.thread.lastUserMessageAt).not.toBeNull()

    const blocked = await runtime.request({
      method: "thread.setDone",
      params: { threadId: created.id, done: true },
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe("thread-blocked")

    harness.runs[0]?.emit({ type: "turn.completed" })
    harness.runs[0]?.finish()
    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: created.id },
        })
      )
      return view.thread.lastTurnCompletedAt !== null
    })

    const visited = unwrap(
      await runtime.request({
        method: "thread.markVisited",
        params: { threadId: created.id },
      })
    )
    expect(visited.lastVisitedAt).not.toBeNull()
    await runtime.close()
  })

  it("deletes a Thread with its turn, and stops the harness working on it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const created = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: created.id, prompt: "Summarize the folder" },
      })
    )

    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))

    // Deleting outranks the activity guards: a task the user gave up on may
    // well be one whose agent will not stop on its own.
    unwrap(
      await runtime.request({
        method: "thread.delete",
        params: { threadId: created.id },
      })
    )
    expect(harness.runs[0]!.cancelled).toBe(true)

    // Removal has its own event: `thread.changed` would send open views back
    // to `thread.get` for a task that is no longer there.
    expect(events).toContain("thread.deleted")
    expect(events).not.toContain("thread.changed")

    const remaining = unwrap(
      await runtime.request({
        method: "thread.list",
        params: { projectId: project.id },
      })
    )
    expect(remaining).toHaveLength(0)

    const missing = await runtime.request({
      method: "thread.get",
      params: { threadId: created.id },
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe("thread-not-found")

    const again = await runtime.request({
      method: "thread.delete",
      params: { threadId: created.id },
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe("thread-not-found")
    await runtime.close()
  })

  it("ignores a pending approval response that fails after deletion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const approvalHarness = delayedApprovalHarness()
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [approvalHarness.factory],
    })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Prepare the report" },
      })
    )
    approvalHarness.harness.runs[0]!.emit({
      type: "approval.requested",
      request: { id: "approval-1", kind: "file-change", title: "Save report" },
    })

    let approvalId: string | undefined
    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      approvalId = view.pendingApproval?.id
      return approvalId !== undefined
    })

    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))
    const resolution = runtime.request({
      method: "approval.resolve",
      params: {
        threadId: thread.id,
        approvalId: approvalId!,
        decision: "approve",
      },
    })
    await approvalHarness.responding

    unwrap(
      await runtime.request({
        method: "thread.delete",
        params: { threadId: thread.id },
      })
    )
    approvalHarness.rejectResponse(new Error("Approval channel closed"))

    const response = await resolution
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe("turn-not-active")
    expect(events).toContain("thread.deleted")
    expect(events).not.toContain("thread.changed")
    await runtime.close()
  })

  it("persists a resumable session and forwards an approval to its active harness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const firstHarness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({ databasePath, harnesses: [firstHarness] })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
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
      type: "usage.updated",
      usage: { usedTokens: 84_000, maxTokens: 200_000 },
    })
    // A max-less reading keeps the last known window.
    firstRun.emit({ type: "usage.updated", usage: { usedTokens: 90_000 } })
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
    expect(persisted.thread.contextUsage).toEqual({
      usedTokens: 90_000,
      maxTokens: 200_000,
    })

    const sameModel = unwrap(
      await resumedRuntime.request({
        method: "thread.configure",
        params: {
          threadId: thread.id,
          executionProfile: {
            modelId: "test-model",
            effort: "medium",
            permissionMode: "full-access",
          },
        },
      })
    )
    expect(sameModel.thread.contextUsage).toEqual({
      usedTokens: 90_000,
      maxTokens: 200_000,
    })

    const changedModel = unwrap(
      await resumedRuntime.request({
        method: "thread.configure",
        params: {
          threadId: thread.id,
          executionProfile: {
            modelId: null,
            effort: null,
            permissionMode: "full-access",
          },
        },
      })
    )
    expect(changedModel.thread.contextUsage).toBeUndefined()

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
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
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

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const blocked = await runtime.request({
      method: "thread.create",
      params: { projectId: project.id, harnessId: "claude" },
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
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })

    const empty = unwrap(
      await runtime.request({
        method: "preferences.get",
        params: { workspaceId: "personal" },
      })
    )
    expect(empty.lastProfile).toBeNull()

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    unwrap(
      await runtime.request({
        method: "thread.create",
        params: {
          projectId: project.id,
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
      await resumedRuntime.request({
        method: "preferences.get",
        params: { workspaceId: "personal" },
      })
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
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({ databasePath, harnesses: [] })
    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))

    const defaults = unwrap(
      await runtime.request({ method: "settings.get", params: {} })
    )
    expect(defaults.values["keybindings.new-task"]).toBe("mod+n")
    expect(defaults.values["models.thread-title"]).toEqual({
      harnessId: null,
      modelId: null,
    })
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

    const unsafeKeybinding = await runtime.request({
      method: "settings.update",
      params: { entries: { "keybindings.new-task": "n" } },
    })
    expect(unsafeKeybinding.ok).toBe(false)
    if (!unsafeKeybinding.ok)
      expect(unsafeKeybinding.error.code).toBe("invalid-setting")

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

  it("groups projects into workspaces and keeps them when a workspace goes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })
    const events: string[] = []
    runtime.subscribe((event) => events.push(event.type))

    const initial = unwrap(
      await runtime.request({ method: "workspace.list", params: {} })
    )
    expect(initial).toMatchObject([{ id: "personal", name: "Personal" }])

    const press = unwrap(
      await runtime.request({
        method: "workspace.create",
        params: { name: "Press", color: "blue", icon: "newspaper" },
      })
    )
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: press.id },
      })
    )
    expect(project.workspaceId).toBe(press.id)

    const other = unwrap(
      await runtime.request({
        method: "workspace.create",
        params: { name: "Other", color: "rose", icon: "star" },
      })
    )

    unwrap(
      await runtime.request({
        method: "selection.set",
        params: { workspaceId: press.id, projectId: project.id },
      })
    )

    const mismatchedSelection = await runtime.request({
      method: "selection.set",
      params: { workspaceId: other.id, projectId: project.id },
    })
    expect(mismatchedSelection.ok).toBe(false)
    if (!mismatchedSelection.ok)
      expect(mismatchedSelection.error.code).toBe("invalid-selection")

    const missingWorkspaceSelection = await runtime.request({
      method: "selection.set",
      params: { workspaceId: "missing" },
    })
    expect(missingWorkspaceSelection.ok).toBe(false)
    if (!missingWorkspaceSelection.ok)
      expect(missingWorkspaceSelection.error.code).toBe("workspace-not-found")

    const missingProjectSelection = await runtime.request({
      method: "selection.set",
      params: { workspaceId: press.id, projectId: "missing" },
    })
    expect(missingProjectSelection.ok).toBe(false)
    if (!missingProjectSelection.ok)
      expect(missingProjectSelection.error.code).toBe("project-not-found")

    expect(
      unwrap(await runtime.request({ method: "selection.get", params: {} }))
    ).toEqual({
      lastWorkspaceId: press.id,
      lastProjectIds: { [press.id]: project.id },
    })

    unwrap(
      await runtime.request({
        method: "workspace.delete",
        params: { workspaceId: press.id },
      })
    )
    const remaining = unwrap(
      await runtime.request({ method: "workspace.list", params: {} })
    )
    expect(remaining.map((workspace) => workspace.id)).toEqual([
      "personal",
      other.id,
    ])

    const projects = unwrap(
      await runtime.request({ method: "project.list", params: {} })
    )
    expect(projects).toMatchObject([
      { id: project.id, workspaceId: "personal" },
    ])

    const selection = unwrap(
      await runtime.request({ method: "selection.get", params: {} })
    )
    expect(selection).toEqual({ lastWorkspaceId: null, lastProjectIds: {} })

    const undeletable = await runtime.request({
      method: "workspace.delete",
      params: { workspaceId: "personal" },
    })
    expect(undeletable.ok).toBe(false)
    if (!undeletable.ok)
      expect(undeletable.error.code).toBe("workspace-not-deletable")

    const conflict = await runtime.request({
      method: "project.add",
      params: { path: directory, name: "Example", workspaceId: other.id },
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok)
      expect(conflict.error.code).toBe("project-in-other-workspace")

    expect(events).toEqual([
      "workspace.changed",
      "workspace.changed",
      "workspace.changed",
      "workspace.changed",
      "pack.changed",
    ])
    await runtime.close()
  })

  it("delivers workspace pack skills to the harness session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      packsPath: join(directory, "packs"),
      harnesses: [harness],
    })

    const created = unwrap(
      await runtime.request({
        method: "pack.create",
        params: { name: "Press tools" },
      })
    )
    expect(created.path).toBe(join(directory, "packs", "press-tools"))
    expect(created.skills).toEqual([])

    const malformedPackPath = join(directory, "malformed-pack")
    await mkdir(malformedPackPath)
    await writeFile(join(malformedPackPath, "skills"), "not a directory")
    const malformedPack = await runtime.request({
      method: "pack.import",
      params: { path: malformedPackPath },
    })
    expect(malformedPack.ok).toBe(false)
    if (!malformedPack.ok) expect(malformedPack.error.code).toBe("invalid-pack")
    expect(
      existingSkillRoots([{ path: malformedPackPath, name: "Malformed" }])
    ).toEqual([])

    const invalidAttachment = await runtime.request({
      method: "workspace.setPack",
      params: { workspaceId: "missing", packId: created.id, attached: true },
    })
    expect(invalidAttachment.ok).toBe(false)
    if (!invalidAttachment.ok)
      expect(invalidAttachment.error.code).toBe("workspace-not-found")

    await mkdir(join(created.path, "skills", "summarize"), { recursive: true })
    await writeFile(
      join(created.path, "skills", "summarize", "SKILL.md"),
      '---\nname: summarize\ndescription: "Summarize articles"\n---\n\nDo it.\n'
    )
    await mkdir(join(created.path, "skills", "fallback"), { recursive: true })
    await writeFile(
      join(created.path, "skills", "fallback", "SKILL.md"),
      '---\nname: ""\ndescription: "Use the directory name"\n---\n'
    )
    await writeFile(join(directory, "brief.md"), "Quarterly brief")

    unwrap(
      await runtime.request({
        method: "workspace.setPack",
        params: { workspaceId: "personal", packId: created.id, attached: true },
      })
    )
    const listed = unwrap(
      await runtime.request({ method: "pack.list", params: {} })
    )
    expect(listed).toMatchObject([
      {
        name: "Press tools",
        workspaceIds: ["personal"],
        skills: [
          {
            id: `${created.id}/fallback`,
            packId: created.id,
            packName: "Press tools",
            name: "fallback",
            description: "Use the directory name",
          },
          {
            id: `${created.id}/summarize`,
            packId: created.id,
            packName: "Press tools",
            name: "summarize",
            description: "Summarize articles",
          },
        ],
      },
    ])
    const availableSkills = unwrap(
      await runtime.request({
        method: "workspace.listSkills",
        params: { workspaceId: "personal" },
      })
    )
    expect(availableSkills).toEqual(listed[0]?.skills)

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    expect(
      unwrap(
        await runtime.request({
          method: "project.searchEntries",
          params: { projectId: project.id, query: "brief", limit: 50 },
        })
      )
    ).toContainEqual({ path: "brief.md", kind: "file" })
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: {
          threadId: thread.id,
          input: {
            text: "Summarize @brief.md with $summarize",
            references: [
              {
                kind: "project-entry",
                path: "brief.md",
                entryKind: "file",
              },
              {
                kind: "skill",
                skillId: `${created.id}/summarize`,
                name: "summarize",
              },
            ],
          },
        },
      })
    )
    expect(harness.runs[0]?.input.customization.skillRoots).toEqual([
      { path: join(created.path, "skills"), name: "Press tools" },
    ])
    expect(harness.runs[0]?.input.references).toEqual([
      {
        kind: "project-entry",
        name: "brief.md",
        path: await realpath(join(directory, "brief.md")),
        entryKind: "file",
      },
      {
        kind: "skill",
        name: "summarize",
        path: join(created.path, "skills", "summarize", "SKILL.md"),
      },
    ])
    const view = unwrap(
      await runtime.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )
    expect(view.messages[0]?.references).toEqual([
      { kind: "project-entry", path: "brief.md", entryKind: "file" },
      {
        kind: "skill",
        skillId: `${created.id}/summarize`,
        name: "summarize",
      },
    ])
    await runtime.close()
  })

  it("interleaves typed activities with message segments and streams deltas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })
    const deltas: Extract<
      import("@deskto/protocol").RuntimeEvent,
      { type: "thread.delta" }
    >[] = []
    runtime.subscribe((event) => {
      if (event.type === "thread.delta") deltas.push(event)
    })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Do the work" },
      })
    )

    const run = harness.runs[0]!
    run.emit({ type: "message.delta", text: "Starting on it." })
    run.emit({
      type: "activity.started",
      activity: {
        id: "plan",
        name: "Plan",
        payload: {
          kind: "plan",
          steps: [
            { text: "Research", status: "active" },
            { text: "Write", status: "pending" },
          ],
        },
      },
    })
    run.emit({
      type: "activity.updated",
      update: {
        id: "plan",
        payload: {
          kind: "plan",
          steps: [
            { text: "Research", status: "done" },
            { text: "Write", status: "active" },
          ],
        },
      },
    })
    run.emit({
      type: "activity.started",
      activity: {
        id: "task-1",
        name: "Research the topic",
        payload: { kind: "subagent", agentType: "Explore" },
      },
    })
    run.emit({
      type: "activity.started",
      activity: {
        id: "tool-9",
        name: "Run command",
        detail: "rg sources",
        parentId: "task-1",
        payload: { kind: "tool", tool: "command" },
      },
    })
    run.emit({ type: "activity.completed", id: "tool-9", outcome: "completed" })
    run.emit({
      type: "activity.completed",
      id: "task-1",
      outcome: "completed",
    })
    run.emit({ type: "activity.completed", id: "plan", outcome: "completed" })
    run.emit({ type: "message.delta", text: "All done." })
    run.emit({ type: "turn.completed" })
    run.finish()

    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      return view.thread.status === "idle"
    })

    const view = unwrap(
      await runtime.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )

    // Prose written around tool work lands in separate, ordered segments.
    expect(
      view.messages.map((message) => [message.content, message.ordinal])
    ).toEqual([
      ["Do the work", 0],
      ["Starting on it.", 1],
      ["All done.", 5],
    ])
    expect(view.messages.every((message) => message.state === "complete")).toBe(
      true
    )

    const plan = view.activities.find((activity) => activity.name === "Plan")
    expect(plan).toMatchObject({
      status: "completed",
      ordinal: 2,
      payload: {
        kind: "plan",
        steps: [
          { text: "Research", status: "done" },
          { text: "Write", status: "active" },
        ],
      },
    })

    const subagent = view.activities.find(
      (activity) => activity.payload?.kind === "subagent"
    )
    const child = view.activities.find(
      (activity) => activity.parentActivityId !== undefined
    )
    expect(subagent?.status).toBe("completed")
    expect(child?.parentActivityId).toBe(subagent?.id)
    expect(child?.payload).toEqual({ kind: "tool", tool: "command" })

    // Deltas form one gap-free sequence that ends at the view's cursor.
    expect(deltas.map((event) => event.seq)).toEqual(
      deltas.map((_, index) => index + 1)
    )
    expect(view.seq).toBe(deltas.length)
    expect(
      deltas.some(
        (event) =>
          event.change.type === "message.appended" &&
          event.change.text === "Starting on it."
      )
    ).toBe(true)
    expect(
      deltas.filter((event) => event.change.type === "activity.upserted")
    ).toHaveLength(7)
    await runtime.close()
  })

  it("attributes safe file-change outputs to a Turn and previews them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const projectPath = join(directory, "project")
    await mkdir(projectPath)
    await writeFile(join(projectPath, "report.md"), "# Quarterly report\n")
    await writeFile(join(projectPath, "figures.csv"), "month,revenue\nJan,42\n")
    await writeFile(join(projectPath, "dashboard.html"), "<h1>Dashboard</h1>")
    await writeFile(join(projectPath, "forecast.xlsx"), "xlsx-bytes")
    await writeFile(join(projectPath, "brief.docx"), "docx-bytes")
    await mkdir(join(projectPath, "tmp", "pdfs"), { recursive: true })
    await writeFile(
      join(projectPath, "tmp", "pdfs", "build-report.py"),
      "print('working file')\n"
    )
    await writeFile(join(directory, "secret.txt"), "outside")
    await symlink(join(directory, "secret.txt"), join(projectPath, "link.txt"))

    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({
      databasePath,
      harnesses: [harness],
    })
    const artifactEvents: string[] = []
    runtime.subscribe((event) => {
      if (event.type === "artifact.changed") {
        artifactEvents.push(event.threadId)
      }
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: {
          path: projectPath,
          name: "Example",
          workspaceId: "personal",
        },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Prepare the report" },
      })
    )

    const run = harness.runs[0]!
    run.emit({
      type: "activity.started",
      activity: {
        id: "files",
        name: "Create report files",
        payload: {
          kind: "file-change",
          files: [
            { path: "report.md" },
            { path: join(projectPath, "figures.csv") },
            { path: "dashboard.html" },
            { path: "forecast.xlsx" },
            { path: "brief.docx" },
            { path: "tmp/pdfs/build-report.py" },
            { path: "../secret.txt" },
            { path: "link.txt" },
          ],
        },
      },
    })
    run.emit({ type: "activity.completed", id: "files", outcome: "completed" })

    await waitFor(async () => {
      const outputs = unwrap(
        await runtime.request({
          method: "artifact.list",
          params: { threadId: thread.id },
        })
      )
      return outputs.length === 5
    })

    const outputs = unwrap(
      await runtime.request({
        method: "artifact.list",
        params: { threadId: thread.id },
      })
    )
    expect(
      outputs.map((output) => output.artifact.relativePath).sort()
    ).toEqual([
      "brief.docx",
      "dashboard.html",
      "figures.csv",
      "forecast.xlsx",
      "report.md",
    ])
    expect(outputs.every((output) => output.turnId === run.input.turnId)).toBe(
      true
    )
    expect(artifactEvents).toEqual([thread.id])

    // Simulate a row captured by a version before working directories were
    // filtered. Listing must hide it without deleting the row or project file.
    const legacyDatabase = new DatabaseSync(databasePath)
    const legacyTimestamp = "2026-08-16T12:00:00.000Z"
    legacyDatabase
      .prepare(
        `INSERT INTO artifacts
           (id, project_id, relative_path, name, media_type, preview_kind,
            size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "legacy-working-artifact",
        project.id,
        "tmp/pdfs/build-report.py",
        "build-report.py",
        "text/x-python",
        "text",
        22,
        legacyTimestamp,
        legacyTimestamp
      )
    legacyDatabase
      .prepare(
        "INSERT INTO turn_outputs (turn_id, artifact_id, created_at) VALUES (?, ?, ?)"
      )
      .run(run.input.turnId, "legacy-working-artifact", legacyTimestamp)
    legacyDatabase.close()

    const outputsWithLegacyRow = unwrap(
      await runtime.request({
        method: "artifact.list",
        params: { threadId: thread.id },
      })
    )
    expect(outputsWithLegacyRow).toEqual(outputs)
    expect(
      await readFile(
        join(projectPath, "tmp", "pdfs", "build-report.py"),
        "utf8"
      )
    ).toBe("print('working file')\n")

    const markdown = outputs.find(
      (output) => output.artifact.relativePath === "report.md"
    )!
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: { threadId: thread.id, artifactId: markdown.artifact.id },
        })
      )
    ).toEqual({
      kind: "markdown",
      artifactId: markdown.artifact.id,
      content: "# Quarterly report\n",
    })

    const otherThread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    expect(
      await runtime.request({
        method: "artifact.preview",
        params: {
          threadId: otherThread.id,
          artifactId: markdown.artifact.id,
        },
      })
    ).toEqual({
      ok: false,
      error: { code: "artifact-not-found", message: "Result not found" },
    })

    const csv = outputs.find(
      (output) => output.artifact.relativePath === "figures.csv"
    )!
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: { threadId: thread.id, artifactId: csv.artifact.id },
        })
      )
    ).toMatchObject({ kind: "csv", content: "month,revenue\nJan,42\n" })

    const html = outputs.find(
      (output) => output.artifact.relativePath === "dashboard.html"
    )!
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: { threadId: thread.id, artifactId: html.artifact.id },
        })
      )
    ).toMatchObject({ kind: "html", content: "<h1>Dashboard</h1>" })

    const spreadsheet = outputs.find(
      (output) => output.artifact.relativePath === "forecast.xlsx"
    )!
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: {
            threadId: thread.id,
            artifactId: spreadsheet.artifact.id,
          },
        })
      )
    ).toMatchObject({
      kind: "spreadsheet",
      dataBase64: Buffer.from("xlsx-bytes").toString("base64"),
    })

    const document = outputs.find(
      (output) => output.artifact.relativePath === "brief.docx"
    )!
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: { threadId: thread.id, artifactId: document.artifact.id },
        })
      )
    ).toMatchObject({
      kind: "document",
      dataBase64: Buffer.from("docx-bytes").toString("base64"),
    })

    await writeFile(join(projectPath, "notes.txt"), "settled with the turn")
    run.emit({
      type: "activity.started",
      activity: {
        id: "unfinished-file-activity",
        name: "Write notes",
        payload: {
          kind: "file-change",
          files: [{ path: "notes.txt" }],
        },
      },
    })
    run.emit({ type: "turn.completed" })
    run.finish()
    await waitFor(async () => {
      const settledOutputs = unwrap(
        await runtime.request({
          method: "artifact.list",
          params: { threadId: thread.id },
        })
      )
      return settledOutputs.some(
        (output) => output.artifact.relativePath === "notes.txt"
      )
    })
    await runtime.close()
  })

  it("keeps one Artifact when later Turns change the same result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    await writeFile(join(directory, "report.txt"), "first")
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )

    for (const prompt of ["Draft it", "Revise it"]) {
      unwrap(
        await runtime.request({
          method: "turn.start",
          params: { threadId: thread.id, prompt },
        })
      )
      const run = harness.runs.at(-1)!
      await writeFile(join(directory, "report.txt"), prompt)
      run.emit({
        type: "activity.started",
        activity: {
          id: `file-${prompt}`,
          name: "Write report",
          payload: {
            kind: "file-change",
            files: [{ path: "report.txt" }],
          },
        },
      })
      run.emit({
        type: "activity.completed",
        id: `file-${prompt}`,
        outcome: "completed",
      })
      run.emit({ type: "turn.completed" })
      run.finish()
      await waitFor(async () => {
        const view = unwrap(
          await runtime.request({
            method: "thread.get",
            params: { threadId: thread.id },
          })
        )
        return view.thread.status === "idle"
      })
    }

    const outputs = unwrap(
      await runtime.request({
        method: "artifact.list",
        params: { threadId: thread.id },
      })
    )
    expect(outputs).toHaveLength(1)
    expect(outputs[0]?.turnId).toBe(harness.runs[1]?.input.turnId)
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: {
            threadId: thread.id,
            artifactId: outputs[0]!.artifact.id,
          },
        })
      )
    ).toMatchObject({ kind: "text", content: "Revise it" })
    await runtime.close()
  })

  it("locates a result and writes back only editable formats", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const projectPath = await realpath(directory)
    await writeFile(join(projectPath, "customers.csv"), "name\nAva\n")
    await writeFile(join(projectPath, "forecast.xlsx"), "xlsx-bytes")

    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(tmpdir(), `deskto-${Date.now()}.sqlite`),
      harnesses: [harness],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: projectPath, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Build the list" },
      })
    )
    const run = harness.runs[0]!
    run.emit({
      type: "activity.started",
      activity: {
        id: "files",
        name: "Write files",
        payload: {
          kind: "file-change",
          files: [{ path: "customers.csv" }, { path: "forecast.xlsx" }],
        },
      },
    })
    run.emit({ type: "activity.completed", id: "files", outcome: "completed" })
    await waitFor(async () => {
      const outputs = unwrap(
        await runtime.request({
          method: "artifact.list",
          params: { threadId: thread.id },
        })
      )
      return outputs.length === 2
    })

    const outputs = unwrap(
      await runtime.request({
        method: "artifact.list",
        params: { threadId: thread.id },
      })
    )
    const csv = outputs.find(
      (output) => output.artifact.relativePath === "customers.csv"
    )!.artifact
    const workbook = outputs.find(
      (output) => output.artifact.relativePath === "forecast.xlsx"
    )!.artifact

    expect(
      unwrap(
        await runtime.request({
          method: "artifact.locate",
          params: { threadId: thread.id, artifactId: csv.id },
        })
      )
    ).toEqual({
      artifactId: csv.id,
      absolutePath: join(projectPath, "customers.csv"),
      device: expect.any(String),
      inode: expect.any(String),
      openable: true,
    })

    // A stale base version means the file moved on since the editor read it.
    expect(
      await runtime.request({
        method: "artifact.write",
        params: {
          threadId: thread.id,
          artifactId: csv.id,
          content: "name\nAva\nLiam\n",
          baseUpdatedAt: "1999-01-01T00:00:00.000Z",
        },
      })
    ).toMatchObject({ ok: false, error: { code: "artifact-conflict" } })

    expect(
      await runtime.request({
        method: "artifact.write",
        params: {
          threadId: thread.id,
          artifactId: workbook.id,
          content: "rewritten",
          baseUpdatedAt: workbook.updatedAt,
        },
      })
    ).toMatchObject({ ok: false, error: { code: "artifact-read-only" } })

    const saved = unwrap(
      await runtime.request({
        method: "artifact.write",
        params: {
          threadId: thread.id,
          artifactId: csv.id,
          content: "name\nAva\nLiam\n",
          baseUpdatedAt: csv.updatedAt,
        },
      })
    )
    expect(saved.sizeBytes).toBe("name\nAva\nLiam\n".length)
    expect(await readFile(join(projectPath, "customers.csv"), "utf8")).toBe(
      "name\nAva\nLiam\n"
    )
    expect(
      unwrap(
        await runtime.request({
          method: "artifact.preview",
          params: { threadId: thread.id, artifactId: csv.id },
        })
      )
    ).toMatchObject({ kind: "csv", content: "name\nAva\nLiam\n" })

    run.emit({ type: "turn.completed" })
    run.finish()
    await runtime.close()
  })

  it("applies the output limit to each completed file-change Activity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const paths = Array.from(
      { length: 205 },
      (_, index) => `result-${index}.txt`
    )
    await Promise.all(
      paths.map((path) => writeFile(join(directory, path), path))
    )
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Create the files" },
      })
    )

    const run = harness.runs[0]!
    for (const [index, activityPaths] of [
      paths.slice(0, 201),
      paths.slice(201),
    ].entries()) {
      run.emit({
        type: "activity.started",
        activity: {
          id: `files-${index}`,
          name: "Create result files",
          payload: {
            kind: "file-change",
            files: activityPaths.map((path) => ({ path })),
          },
        },
      })
    }
    run.emit({ type: "turn.completed" })
    run.finish()

    await waitFor(async () => {
      const outputs = unwrap(
        await runtime.request({
          method: "artifact.list",
          params: { threadId: thread.id },
        })
      )
      return outputs.length === 204
    })
    const outputs = unwrap(
      await runtime.request({
        method: "artifact.list",
        params: { threadId: thread.id },
      })
    )
    expect(outputs).toHaveLength(204)
    await runtime.close()
  })

  it("orders prose after the tool work it follows and settles leftovers by outcome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
    directories.push(directory)
    const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
    const runtime = createRuntime({
      databasePath: join(directory, "runtime.sqlite"),
      harnesses: [harness],
    })

    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "claude" },
      })
    )
    unwrap(
      await runtime.request({
        method: "turn.start",
        params: { threadId: thread.id, prompt: "Check the tests" },
      })
    )

    // The very first harness output is a tool call, before any prose.
    const run = harness.runs[0]!
    run.emit({
      type: "activity.started",
      activity: {
        id: "tool-1",
        name: "Run command",
        detail: "pnpm test",
        payload: { kind: "tool", tool: "command" },
      },
    })
    run.emit({ type: "message.delta", text: "Tests pass." })
    run.emit({
      type: "activity.started",
      activity: {
        id: "orphan-tool",
        parentId: "missing-parent",
        name: "Read file",
        detail: "draft.md",
        payload: { kind: "tool", tool: "other" },
      },
    })
    run.emit({
      type: "activity.updated",
      update: { id: "orphan-tool", detail: "" },
    })
    run.emit({ type: "message.delta", text: "Checked the result." })
    run.emit({ type: "turn.completed" })
    run.finish()

    await waitFor(async () => {
      const view = unwrap(
        await runtime.request({
          method: "thread.get",
          params: { threadId: thread.id },
        })
      )
      return view.thread.status === "idle"
    })

    const view = unwrap(
      await runtime.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )
    const activity = view.activities[0]!
    const orphan = view.activities.find(
      (candidate) => candidate.name === "Read file"
    )!
    const summary = view.messages.find(
      (message) => message.content === "Tests pass."
    )!
    // The narration sorts after the tool row it describes.
    expect(summary.ordinal).toBeGreaterThan(activity.ordinal!)
    const following = view.messages.find(
      (message) => message.content === "Checked the result."
    )!
    expect(orphan.parentActivityId).toBeUndefined()
    expect(orphan.detail).toBeUndefined()
    expect(following.ordinal).toBeGreaterThan(orphan.ordinal!)
    // The tool never reported completion; a finished turn settles it as
    // completed rather than blaming it with a failure mark.
    expect(activity.status).toBe("completed")
    await runtime.close()
  })

  it("cancels a turn while its harness is still starting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-runtime-"))
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
    const project = unwrap(
      await runtime.request({
        method: "project.add",
        params: { path: directory, name: "Example", workspaceId: "personal" },
      })
    )
    const thread = unwrap(
      await runtime.request({
        method: "thread.create",
        params: { projectId: project.id, harnessId: "slow" },
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

function recordingTitleHarness(options: {
  id: string
  modelId: string
  supportedEfforts?: string[]
  generate: () => Promise<string>
}) {
  const scripted = new ScriptedHarness({ id: options.id, name: options.id })
  const inputs: TextGenerationInput[] = []
  const factory: HarnessAdapterFactory = {
    descriptor: scripted.descriptor,
    checkAvailability: () => scripted.checkAvailability(),
    listModels: () =>
      Promise.resolve([
        {
          id: options.modelId,
          name: options.modelId,
          supportedEfforts: options.supportedEfforts ?? [],
          isDefault: true,
          supportedPermissionModes: [
            "approval-required",
            "auto",
            "full-access",
          ],
        },
      ]),
    start: (input, signal) => scripted.start(input, signal),
    generateText: (input) => {
      inputs.push(input)
      return options.generate()
    },
  }
  return { factory, inputs }
}

function unwrap<T>(
  response: { ok: true; data: T } | { ok: false; error: unknown }
): T {
  if (!response.ok) throw new Error(JSON.stringify(response.error))
  return response.data
}

function delayedApprovalHarness() {
  const harness = new ScriptedHarness({ id: "claude", name: "Claude" })
  let markResponding: (() => void) | undefined
  let rejectResponse: ((error: Error) => void) | undefined
  const responding = new Promise<void>((resolve) => {
    markResponding = resolve
  })
  const factory: HarnessAdapterFactory = {
    descriptor: harness.descriptor,
    checkAvailability: () => harness.checkAvailability(),
    listModels: () => harness.listModels(),
    start: async (input, signal) => {
      const session = await harness.start(input, signal)
      return {
        ...session,
        respondToApproval: () => {
          markResponding?.()
          return new Promise<void>((_resolve, reject) => {
            rejectResponse = reject
          })
        },
      }
    },
  }
  return {
    factory,
    harness,
    responding,
    rejectResponse(error: Error) {
      if (!rejectResponse) throw new Error("No approval response is pending")
      rejectResponse(error)
    },
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Condition was not met")
}
