// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { RuntimeClient } from "@deskto/client"
import type { Harness, RuntimeTransport } from "@deskto/protocol"
import { resolveSettings } from "@deskto/settings"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../../runtime/runtime-client-context.js"
import { SettingsProvider } from "../../settings/settings-context.js"
import type { RuntimeQuery } from "../../runtime/use-runtime-query.js"
import { OnboardingView } from "./onboarding-view.js"

const notSignedIn = "Claude Code is not signed in."
const notFound = "Codex CLI was not found."

const unavailableHarnesses: Harness[] = [
  harness("claude", "Claude Code", { status: "unavailable", reason: notSignedIn }),
  harness("codex", "Codex", { status: "unavailable", reason: notFound }),
]

const readyHarnesses: Harness[] = [
  harness("claude", "Claude Code", { status: "available", version: "2.1.0" }),
  harness("codex", "Codex", { status: "unavailable", reason: notFound }),
]

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
})

afterEach(cleanup)

describe("OnboardingView", () => {
  it("walks the explainer steps in order and announces each", () => {
    renderOnboarding({})

    expect(screen.getByLabelText("Step 1 of 7")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Get started" }))
    expect(
      screen.getByRole("heading", { name: "An inbox, not a chat log" })
    ).toBeTruthy()
    expect(screen.getByLabelText("Step 2 of 7")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(
      screen.getByRole("heading", { name: "Projects scope the work" })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(
      screen.getByRole("heading", { name: "Tasks that delegate tasks" })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(screen.getByRole("heading", { name: "Make it yours" })).toBeTruthy()
    expect(screen.getByLabelText("Step 5 of 7")).toBeTruthy()
  })

  it("writes the theme setting when a palette is picked", async () => {
    const { request } = renderOnboarding({})
    goToAppearanceStep()

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "settings.update",
        params: { entries: { "appearance.theme": "dark" } },
      })
    )
  })

  it("blocks Continue and shows setup while no agent is available", () => {
    renderOnboarding({ harnesses: unavailableHarnesses })
    goToAgentStep()

    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(true)
    expect(screen.getByText(notSignedIn)).toBeTruthy()
    expect(screen.getByText(notFound)).toBeTruthy()
    expect(
      screen.getByText("npm install -g @anthropic-ai/claude-code")
    ).toBeTruthy()
    expect(screen.getByText("npm install -g @openai/codex")).toBeTruthy()
  })

  it("unblocks Continue when an agent turns ready", () => {
    const { rerender, view } = renderOnboarding({
      harnesses: unavailableHarnesses,
    })
    goToAgentStep()

    rerender(view({ harnesses: readyHarnesses }))
    expect(screen.getByText("Ready · version 2.1.0")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")
    ).toBe(false)
  })

  it("copies the install command", () => {
    renderOnboarding({ harnesses: unavailableHarnesses })
    goToAgentStep()

    fireEvent.click(
      screen.getAllByRole("button", { name: "Copy install command" })[0]!
    )
    expect(writeText).toHaveBeenCalledWith(
      "npm install -g @anthropic-ai/claude-code"
    )
    expect(
      screen.getAllByRole("button", { name: "Copied" }).length
    ).toBeGreaterThan(0)
  })

  it("re-probes on Check again and applies the answer", async () => {
    const replace = vi.fn()
    const { request } = renderOnboarding({
      harnesses: unavailableHarnesses,
      replace,
    })
    goToAgentStep()

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        method: "harness.refresh",
        params: {},
      })
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith(readyHarnesses))
  })

  it("opens project creation and finishes once a project appears", () => {
    const onCreateProject = vi.fn()
    const onFinish = vi.fn()
    const { rerender, view } = renderOnboarding({
      harnesses: readyHarnesses,
      onCreateProject,
      onFinish,
    })
    goToProjectStep()

    fireEvent.click(screen.getByRole("button", { name: "Create project" }))
    expect(onCreateProject).toHaveBeenCalled()
    expect(onFinish).not.toHaveBeenCalled()

    rerender(
      view({ harnesses: readyHarnesses, hasProject: true, onCreateProject, onFinish })
    )
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it("pre-confirms the project step for machines that already have one", () => {
    const onFinish = vi.fn()
    renderOnboarding({
      harnesses: readyHarnesses,
      hasProject: true,
      onFinish,
    })
    goToProjectStep()

    expect(screen.getByRole("heading", { name: "You are all set" })).toBeTruthy()
    expect(onFinish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Finish" }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it("finishes on skip from the welcome step", () => {
    const onFinish = vi.fn()
    renderOnboarding({ onFinish })

    fireEvent.click(screen.getByRole("button", { name: "Skip setup" }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it("finishes on skip from a later step", () => {
    const onFinish = vi.fn()
    renderOnboarding({ harnesses: unavailableHarnesses, onFinish })
    goToAgentStep()

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })
})

function goToAppearanceStep() {
  fireEvent.click(screen.getByRole("button", { name: "Get started" }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
}

function goToAgentStep() {
  goToAppearanceStep()
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
}

function goToProjectStep() {
  goToAgentStep()
  fireEvent.click(screen.getByRole("button", { name: "Continue" }))
}

function renderOnboarding({
  harnesses = readyHarnesses,
  hasProject = false,
  replace = vi.fn(),
  onCreateProject = vi.fn(),
  onFinish = vi.fn(),
}: {
  harnesses?: Harness[]
  hasProject?: boolean
  replace?: (data: Harness[]) => void
  onCreateProject?: () => void
  onFinish?: () => void
}) {
  const request = vi.fn((body: { method: string }) => {
    if (body.method === "settings.get") {
      return Promise.resolve({ ok: true as const, data: resolveSettings({}) })
    }
    if (body.method === "settings.update") {
      return Promise.resolve({ ok: true as const, data: resolveSettings({}) })
    }
    if (body.method === "harness.refresh") {
      return Promise.resolve({ ok: true as const, data: readyHarnesses })
    }
    return Promise.reject(new Error(`Unexpected request: ${body.method}`))
  })

  const view = ({
    harnesses: currentHarnesses = harnesses,
    hasProject: currentHasProject = hasProject,
    onCreateProject: currentOnCreate = onCreateProject,
    onFinish: currentOnFinish = onFinish,
  }: {
    harnesses?: Harness[]
    hasProject?: boolean
    onCreateProject?: () => void
    onFinish?: () => void
  }) => (
    <RuntimeClientProvider
      client={
        new RuntimeClient({
          // SAFETY: these tests exercise only the handled requests.
          request: request as RuntimeTransport["request"],
          subscribe: () => () => {},
        })
      }
    >
      <SettingsProvider>
        <OnboardingView
          harnesses={runtimeQuery(currentHarnesses, replace)}
          workspaceReady
          hasProject={currentHasProject}
          creatingProject={false}
          onCreateProject={currentOnCreate}
          onFinish={currentOnFinish}
        />
      </SettingsProvider>
    </RuntimeClientProvider>
  )

  return { ...render(view({})), view, request }
}

function runtimeQuery(
  data: Harness[],
  replace: (data: Harness[]) => void
): RuntimeQuery<Harness[]> {
  return {
    state: { status: "ready", data },
    revalidate: vi.fn(),
    replace,
    patch: vi.fn(),
  }
}

function harness(
  id: string,
  name: string,
  availability: Harness["availability"]
): Harness {
  return {
    id,
    name,
    enabled: true,
    availability,
    checkedAt: "2026-08-19T08:00:00.000Z",
    models: [],
  }
}
