import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  harnessFailure,
  type HarnessAdapterFactory,
  type TextGenerationInput,
} from "@openappto/harness-sdk"
import { ScriptedHarness } from "@openappto/harness-sdk/testing"
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
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
    for (let attempts = 0; attempts < 3; attempts += 1) {
      await Promise.resolve()
    }

    const view = unwrap(
      await runtime.request({
        method: "thread.get",
        params: { threadId: thread.id },
      })
    )
    expect(view.thread.title).toBe("New task")
    expect(main.inputs).toEqual([])
    await runtime.close()
  })

  it("persists a provider-neutral usage limit in the thread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
    expect(harnessFailure("Provider process exited").kind).toBe("error")
  })

  it("persists a resumable session and forwards an approval to its active harness", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
    directories.push(directory)
    const databasePath = join(directory, "runtime.sqlite")
    const runtime = createRuntime({
      databasePath,
      harnesses: [new ScriptedHarness({ id: "claude", name: "Claude" })],
    })

    const empty = unwrap(
      await runtime.request({ method: "preferences.get", params: { workspaceId: "personal" } })
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
      await resumedRuntime.request({ method: "preferences.get", params: { workspaceId: "personal" } })
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
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
    expect(projects).toMatchObject([{ id: project.id, workspaceId: "personal" }])

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
    const directory = await mkdtemp(join(tmpdir(), "openappto-runtime-"))
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
        skills: [{ name: "summarize", description: "Summarize articles" }],
      },
    ])

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
        params: { threadId: thread.id, prompt: "Summarize this" },
      })
    )
    expect(harness.runs[0]?.input.customization.skillRoots).toEqual([
      { path: join(created.path, "skills"), name: "Press tools" },
    ])
    await runtime.close()
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

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Condition was not met")
}
