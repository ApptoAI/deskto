import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { RuntimeClient } from "@deskto/client"
import type { RuntimeEvent, RuntimeTransport } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../runtime/runtime-client-context.js"
import { Composer } from "./composer.js"

const unusedTransport: RuntimeTransport = {
  request: () => Promise.reject(new Error("This test does not make requests")),
  subscribe: () => () => {},
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})

describe("Composer", () => {
  it("sends selected browser elements and clears them after success", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    const onClearBrowserContexts = vi.fn()
    render(
      <RuntimeClientProvider client={new RuntimeClient(unusedTransport)}>
        <Composer
          projectId="project-1"
          label="Message"
          placeholder="Describe the task"
          browserContexts={[
            {
              id: "1b9a61ab-dd90-4b3f-ad05-94badf1c6842",
              source: {
                url: "https://example.com/settings",
                title: "Settings",
              },
              selector: "body > main > button",
              tagName: "button",
              role: "button",
              name: "Save",
              text: "Save changes",
              capturedAt: "2026-08-18T10:00:00.000Z",
            },
          ]}
          onClearBrowserContexts={onClearBrowserContexts}
          onSend={onSend}
        />
      </RuntimeClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      text: "",
      browserContexts: [
        expect.objectContaining({ name: "Save", tagName: "button" }),
      ],
    })
    expect(onClearBrowserContexts).toHaveBeenCalledWith([
      "1b9a61ab-dd90-4b3f-ad05-94badf1c6842",
    ])
  })

  it("does not clear an element selected while the Turn is starting", async () => {
    let finishSend: (() => void) | undefined
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve
        })
    )
    const onClearBrowserContexts = vi.fn()
    const first = {
      id: "1b9a61ab-dd90-4b3f-ad05-94badf1c6842",
      source: { url: "https://example.com/settings", title: "Settings" },
      selector: "body > main > button",
      tagName: "button",
      role: "button",
      name: "Save",
      text: "Save changes",
      capturedAt: "2026-08-18T10:00:00.000Z",
    }
    const next = {
      ...first,
      id: "216bf37a-d634-4868-a446-a2bbf60bdf0a",
      selector: "body > main > a",
      tagName: "a",
      role: "link",
      name: "Next",
      text: "Next page",
    }
    const renderComposer = (browserContexts: (typeof first)[]) => (
      <RuntimeClientProvider client={new RuntimeClient(unusedTransport)}>
        <Composer
          projectId="project-1"
          label="Message"
          placeholder="Describe the task"
          browserContexts={browserContexts}
          onClearBrowserContexts={onClearBrowserContexts}
          onSend={onSend}
        />
      </RuntimeClientProvider>
    )
    const view = render(renderComposer([first]))

    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    view.rerender(renderComposer([first, next]))
    finishSend?.()

    await waitFor(() =>
      expect(onClearBrowserContexts).toHaveBeenCalledWith([first.id])
    )
  })

  it("attaches pasted images and keeps Shift+Enter for a new line", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(
      <RuntimeClientProvider client={new RuntimeClient(unusedTransport)}>
        <Composer
          projectId="project-1"
          label="Message"
          placeholder="Describe the task"
          onSend={onSend}
        />
      </RuntimeClientProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Message" })
    const image = new File(["pixels"], "screen.png", { type: "image/png" })

    fireEvent.paste(textarea, { clipboardData: { files: [image] } })
    await screen.findByAltText("screen.png")

    fireEvent.change(textarea, {
      target: { value: "Review this", selectionStart: 11 },
    })
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: "Enter" })
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      text: "Review this",
      attachments: [
        {
          type: "image",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 6,
        },
      ],
    })
  })

  it("keeps Shift+Enter available while suggestions are open", () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    const onOpenModelPicker = vi.fn()
    render(
      <RuntimeClientProvider client={new RuntimeClient(unusedTransport)}>
        <Composer
          projectId="project-1"
          label="Message"
          placeholder="Describe the task"
          onSend={vi.fn().mockResolvedValue(undefined)}
          onOpenModelPicker={onOpenModelPicker}
        />
      </RuntimeClientProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Message" })
    fireEvent.change(textarea, {
      target: { value: "/", selectionStart: 1 },
    })

    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(
      true
    )
    expect(onOpenModelPicker).not.toHaveBeenCalled()
  })

  it("does not accept another attachment while a send is pending", async () => {
    let finishSend: (() => void) | undefined
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve
        })
    )
    render(
      <RuntimeClientProvider client={new RuntimeClient(unusedTransport)}>
        <Composer
          projectId="project-1"
          label="Message"
          placeholder="Describe the task"
          onSend={onSend}
        />
      </RuntimeClientProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Message" })
    const first = new File(["first"], "first.png", { type: "image/png" })
    const second = new File(["second"], "second.png", { type: "image/png" })

    fireEvent.paste(textarea, { clipboardData: { files: [first] } })
    await screen.findByAltText("first.png")
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce())

    fireEvent.paste(textarea, { clipboardData: { files: [second] } })
    expect(screen.queryByAltText("second.png")).toBeNull()
    expect(
      fireEvent.drop(textarea.closest("form")!, {
        dataTransfer: { types: ["Files"], files: [second] },
      })
    ).toBe(false)
    expect(screen.queryByAltText("second.png")).toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Attach images" })
        .disabled
    ).toBe(true)

    finishSend?.()
    await waitFor(() => expect(screen.queryByAltText("first.png")).toBeNull())
  })

  it("reads the skill list once per $, and again for the next one", async () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    const request = vi.fn((body: { method: string }) =>
      Promise.resolve(
        body.method === "skill.listForPrompt"
          ? {
              ok: true as const,
              data: [
                {
                  id: "skill:animate",
                  name: "animate",
                  description: "Build an animation",
                  origin: "native" as const,
                  sourceLabel: "Claude personal skills",
                  harnessIds: ["claude"],
                },
              ],
            }
          : { ok: true as const, data: [] }
      )
    )
    render(
      <RuntimeClientProvider
        client={
          new RuntimeClient({
            // SAFETY: the composer calls only skill.listForPrompt and
            // project.searchEntries, and this fake answers both with the shape
            // their RuntimeResponses entry declares.
            request: request as RuntimeTransport["request"],
            subscribe: () => () => {},
          })
        }
      >
        <Composer
          projectId="project-1"
          harnessId="claude"
          label="Message"
          placeholder="Describe the task"
          onSend={vi.fn().mockResolvedValue(undefined)}
        />
      </RuntimeClientProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Message" })
    const listings = () =>
      vi
        .mocked(request)
        .mock.calls.filter(([body]) => body.method === "skill.listForPrompt")
        .length

    fireEvent.change(textarea, { target: { value: "$", selectionStart: 1 } })
    await screen.findByText("$animate")
    fireEvent.change(textarea, { target: { value: "$an", selectionStart: 3 } })
    await waitFor(() => expect(listings()).toBe(1))

    // A second `$` is a second read: skills live in folders someone can edit
    // between two messages.
    fireEvent.change(textarea, {
      target: { value: "$animate now $", selectionStart: 14 },
    })
    await waitFor(() => expect(listings()).toBe(2))
  })

  it("keeps an in-flight skill read when the query changes", async () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    const response = {
      ok: true as const,
      data: [
        {
          id: "skill:animate",
          name: "animate",
          description: "Build an animation",
          origin: "native" as const,
          sourceLabel: "Claude personal skills",
          harnessIds: ["claude"],
        },
      ],
    }
    let finishRequest!: (value: typeof response) => void
    const pendingRequest = new Promise<typeof response>((resolve) => {
      finishRequest = resolve
    })
    const request = vi.fn((body: { method: string }) =>
      body.method === "skill.listForPrompt"
        ? pendingRequest
        : Promise.resolve({ ok: true as const, data: [] })
    )
    render(
      <RuntimeClientProvider
        client={
          new RuntimeClient({
            // SAFETY: the composer calls only skill.listForPrompt and
            // project.searchEntries, and this fake answers both with the shape
            // their RuntimeResponses entry declares.
            request: request as RuntimeTransport["request"],
            subscribe: () => () => {},
          })
        }
      >
        <Composer
          projectId="project-1"
          harnessId="claude"
          label="Message"
          placeholder="Describe the task"
          onSend={vi.fn().mockResolvedValue(undefined)}
        />
      </RuntimeClientProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Message" })

    fireEvent.change(textarea, { target: { value: "$", selectionStart: 1 } })
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    fireEvent.change(textarea, {
      target: { value: "$an", selectionStart: 3 },
    })
    finishRequest(response)

    expect(await screen.findByText("$animate")).toBeTruthy()
    expect(request).toHaveBeenCalledOnce()
  })

  it("ignores an invalidated skill read after its replacement starts", async () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value })
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    const response = (name: string) => ({
      ok: true as const,
      data: [
        {
          id: `skill:${name}`,
          name,
          description: `${name} skill`,
          origin: "native" as const,
          sourceLabel: "Claude personal skills",
          harnessIds: ["claude"],
        },
      ],
    })
    type Response = ReturnType<typeof response>
    const finishRequests: Array<(value: Response) => void> = []
    const request = vi.fn(
      (body: { method: string }): Promise<Response | { ok: true; data: [] }> =>
        body.method === "skill.listForPrompt"
          ? new Promise<Response>((resolve) => finishRequests.push(resolve))
          : Promise.resolve({ ok: true, data: [] })
    )
    type ListenerHolder = {
      current: ((event: RuntimeEvent) => void) | null
    }
    const listener: ListenerHolder = { current: null }
    render(
      <RuntimeClientProvider
        client={
          new RuntimeClient({
            // SAFETY: the composer calls only skill.listForPrompt and
            // project.searchEntries, and this fake answers both with the shape
            // their RuntimeResponses entry declares.
            request: request as RuntimeTransport["request"],
            subscribe: (next) => {
              listener.current = next
              return () => {
                if (listener.current === next) listener.current = null
              }
            },
          })
        }
      >
        <Composer
          projectId="project-1"
          harnessId="claude"
          label="Message"
          placeholder="Describe the task"
          onSend={vi.fn().mockResolvedValue(undefined)}
        />
      </RuntimeClientProvider>
    )
    const textarea = screen.getByRole("textbox", { name: "Message" })

    fireEvent.change(textarea, { target: { value: "$", selectionStart: 1 } })
    await waitFor(() => expect(finishRequests).toHaveLength(1))
    act(() => listener.current?.({ type: "pack.changed" }))
    fireEvent.change(textarea, {
      target: { value: "$n", selectionStart: 2 },
    })
    await waitFor(() => expect(finishRequests).toHaveLength(2))

    await act(async () => finishRequests[0]?.(response("old")))
    expect(screen.queryByText("$old")).toBeNull()
    await act(async () => finishRequests[1]?.(response("new")))
    expect(await screen.findByText("$new")).toBeTruthy()
  })

  it("describes the cross-platform paste shortcut", () => {
    render(
      <RuntimeClientProvider client={new RuntimeClient(unusedTransport)}>
        <Composer
          projectId="project-1"
          label="Message"
          placeholder="Describe the task"
          onSend={vi.fn().mockResolvedValue(undefined)}
        />
      </RuntimeClientProvider>
    )

    expect(screen.getByTitle(/Ctrl\/Cmd\+V/)).toBeTruthy()
  })
})
// @vitest-environment jsdom
