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
  description: "",
  path: "/projects/example",
  locationKind: "linked",
  pinnedAt: null,
  createdAt: "2026-08-18T08:00:00.000Z",
  updatedAt: "2026-08-18T08:00:00.000Z",
}

const harnesses: Harness[] = [
  harness("claude", "Claude Code", "claude-opus"),
  harness("codex", "Codex", "codex-sol"),
]

afterEach(cleanup)

describe("NewTaskView", () => {
  it("opens project settings automatically when instructions are empty", async () => {
    renderNewTaskView({ instructions: "", panelPreference: "auto" })

    expect(
      await screen.findByRole("region", { name: "Project settings" })
    ).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Project settings" })
        .getAttribute("aria-controls")
    ).toBe("project-settings-panel")
  })

  it("keeps project settings collapsed when instructions exist", async () => {
    renderNewTaskView({
      instructions: "Use the approved terminology.",
      panelPreference: "auto",
    })

    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Project settings" })
          .getAttribute("aria-expanded")
      ).toBe("false")
    )
    expect(
      screen.queryByRole("region", { name: "Project settings" })
    ).toBeNull()
  })

  it("disables instruction editing until project details load", async () => {
    let resolveDetails!: (value: ReturnType<typeof projectDetails>) => void
    const details = new Promise<ReturnType<typeof projectDetails>>(
      (resolve) => {
        resolveDetails = resolve
      }
    )

    renderNewTaskView({
      instructions: "",
      panelPreference: "open",
      details,
    })

    const edit = screen.getByRole("button", {
      name: "Edit project instructions",
    })
    expect(edit.hasAttribute("disabled")).toBe(true)

    resolveDetails(projectDetails("Existing instructions"))
    await waitFor(() => expect(edit.hasAttribute("disabled")).toBe(false))
  })

  it("keeps the project cards mounted after closing the About dialog", async () => {
    renderNewTaskView({ instructions: "", panelPreference: "open" })

    await screen.findByRole("button", { name: "Edit name and description" })
    fireEvent.click(
      screen.getByRole("button", { name: "Edit name and description" })
    )
    expect(
      await screen.findByRole("dialog", { name: "About this project" })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Close" }))

    // jsdom has no CSS animation lifecycle, so Base UI calls
    // onOpenChangeComplete immediately. Waiting for removal still verifies
    // that callback, rather than onOpenChange, unmounts the dialog root.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "About this project" })
      ).toBeNull()
    )
    expect(screen.getByText("About")).toBeTruthy()
    expect(screen.getByText("Instructions")).toBeTruthy()
    expect(screen.getByText("Files")).toBeTruthy()
  })

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
      if (body.method === "project.get") {
        return Promise.resolve({
          ok: true as const,
          data: { project, instructions: "", sourceTemplate: null },
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
          panelPreference="collapsed"
          onPanelCollapsedChange={vi.fn()}
        />
      </RuntimeClientProvider>
    )

    await screen.findByRole("button", { name: "Model: Claude Opus" })
    fireEvent.click(screen.getByRole("button", { name: "Agent: Claude Code" }))
    // Matched loosely: each row now carries a line on what the agent is, so
    // the accessible name is the agent's name plus that sentence.
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^Codex/ }))

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

function renderNewTaskView({
  instructions,
  panelPreference,
  details = Promise.resolve(projectDetails(instructions)),
}: {
  instructions: string
  panelPreference: "open" | "collapsed" | "auto"
  details?: Promise<ReturnType<typeof projectDetails>>
}) {
  const request = vi.fn((body: { method: string }) => {
    if (body.method === "preferences.get") {
      return Promise.resolve({
        ok: true as const,
        data: { lastProfile: null, profilesByHarness: {} },
      })
    }
    if (body.method === "project.get") return details
    return Promise.reject(new Error(`Unexpected request: ${body.method}`))
  })

  return render(
    <RuntimeClientProvider
      client={
        new RuntimeClient({
          // SAFETY: these tests exercise only the handled read requests.
          request: request as RuntimeTransport["request"],
          subscribe: () => () => {},
        })
      }
    >
      <NewTaskView
        project={project}
        harnesses={{ status: "ready", data: harnesses }}
        onTaskCreated={vi.fn()}
        onTaskStarted={vi.fn()}
        panelPreference={panelPreference}
        onPanelCollapsedChange={vi.fn()}
      />
    </RuntimeClientProvider>
  )
}

function projectDetails(instructions: string) {
  return {
    ok: true as const,
    data: { project, instructions, sourceTemplate: null },
  }
}

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
