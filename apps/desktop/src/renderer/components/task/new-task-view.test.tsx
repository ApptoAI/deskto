// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { RuntimeClient } from "@deskto/client"
import type { Harness, Project, RuntimeTransport } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../../runtime/runtime-client-context.js"
import { NewTaskView } from "./new-task-view.js"

const project: Project = {
  id: "project-1",
  workspaceId: "personal",
  name: "Example",
  path: "/projects/example",
  createdAt: "2026-08-18T08:00:00.000Z",
  updatedAt: "2026-08-18T08:00:00.000Z",
}

const harnesses: Harness[] = [
  harness("claude", "Claude Code", "claude-opus"),
  harness("codex", "Codex", "codex-sol"),
]

afterEach(cleanup)

describe("NewTaskView", () => {
  it("sends the saved profile after switching back to a Harness", async () => {
    const request = vi.fn((body: { method: string }) => {
      if (body.method === "preferences.get") {
        return Promise.resolve({
          ok: true as const,
          data: {
            lastProfile: {
              harnessId: "claude",
              executionProfile: {
                modelId: "claude-opus",
                effort: "high",
                permissionMode: "auto" as const,
              },
            },
            profilesByHarness: {
              claude: {
                modelId: "claude-opus",
                effort: "high",
                permissionMode: "auto" as const,
              },
              codex: {
                modelId: "codex-sol",
                effort: "high",
                permissionMode: "auto" as const,
              },
            },
          },
        })
      }
      if (body.method === "thread.create") {
        return Promise.resolve({ ok: true as const, data: { id: "thread-1" } })
      }
      if (body.method === "turn.start") {
        return Promise.resolve({ ok: true as const, data: {} })
      }
      return Promise.reject(new Error(`Unexpected request: ${body.method}`))
    })
    const onTaskStarted = vi.fn()

    render(
      <RuntimeClientProvider
        client={
          new RuntimeClient({
            // SAFETY: this test exercises only the three handled requests.
            request: request as RuntimeTransport["request"],
            subscribe: () => () => {},
          })
        }
      >
        <NewTaskView
          project={project}
          harnesses={{ status: "ready", data: harnesses }}
          onTaskCreated={vi.fn()}
          onTaskStarted={onTaskStarted}
        />
      </RuntimeClientProvider>
    )

    await screen.findByRole("button", { name: "Model: Claude Opus" })
    fireEvent.click(screen.getByRole("button", { name: "Claude Code" }))
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Codex" }))

    expect(
      await screen.findByRole("button", { name: "Model: Codex Sol" })
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Thinking: High" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Permissions: Auto" })
    ).toBeTruthy()

    fireEvent.change(screen.getByRole("textbox", { name: /agent do/ }), {
      target: { value: "Hello" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onTaskStarted).toHaveBeenCalledWith("thread-1"))

    expect(request).toHaveBeenCalledWith({
      method: "thread.create",
      params: {
        projectId: "project-1",
        harnessId: "codex",
        executionProfile: {
          modelId: "codex-sol",
          effort: "high",
          permissionMode: "auto",
        },
      },
    })
  })
})

function harness(id: string, name: string, modelId: string): Harness {
  return {
    id,
    name,
    enabled: true,
    availability: { status: "available" },
    checkedAt: "2026-08-18T08:00:00.000Z",
    models: [
      {
        id: modelId,
        name: modelId === "codex-sol" ? "Codex Sol" : "Claude Opus",
        supportedEfforts: ["low", "high"],
        defaultEffort: "low",
        isDefault: true,
        supportedPermissionModes: ["approval-required", "auto"],
      },
    ],
  }
}
