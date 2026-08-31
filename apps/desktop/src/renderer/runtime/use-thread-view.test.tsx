// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { RuntimeClient } from "@deskto/client"
import type {
  RuntimeEvent,
  RuntimeTransport,
  ThreadView,
} from "@deskto/protocol"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "./runtime-client-context.js"
import { useThreadView } from "./use-thread-view.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(cleanup)

describe("useThreadView", () => {
  it("does not carry transcript reads or events across root task switches", async () => {
    const firstRead = deferred<ThreadView>()
    const listeners = new Set<(event: RuntimeEvent) => void>()
    const client = new RuntimeClient(unusedTransport)
    client.getThread = vi.fn((threadId: string) =>
      threadId === "first"
        ? firstRead.promise
        : Promise.resolve(threadView("second", "second task only"))
    )
    client.subscribe = vi.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RuntimeClientProvider client={client}>{children}</RuntimeClientProvider>
    )
    const { result, rerender } = renderHook(
      ({ threadId }) => useThreadView(threadId),
      { initialProps: { threadId: "first" }, wrapper }
    )

    expect(result.current.state.status).toBe("loading")
    rerender({ threadId: "second" })
    await waitFor(() => expect(result.current.state.status).toBe("ready"))
    expect(readyView(result.current.state).messages[0]?.content).toBe(
      "second task only"
    )

    act(() => {
      for (const listener of listeners) {
        listener({
          type: "thread.delta",
          threadId: "first",
          seq: 1,
          change: {
            type: "message.appended",
            messageId: "message-first",
            text: " leaked event",
          },
        })
      }
    })
    await act(async () => {
      firstRead.resolve(threadView("first", "first task only"))
    })

    expect(readyView(result.current.state).thread.id).toBe("second")
    expect(
      readyView(result.current.state).messages.map((message) => message.content)
    ).toEqual(["second task only"])
  })
})

function threadView(threadId: string, content: string): ThreadView {
  const timestamp = "2026-08-31T10:00:00.000Z"
  return {
    thread: {
      id: threadId,
      projectId: "project",
      parentThreadId: null,
      title: `${threadId} task`,
      harnessId: "codex",
      status: "idle",
      executionProfile: {
        modelId: "gpt-5",
        effort: "high",
        permissionMode: "auto",
      },
      lastUserMessageAt: timestamp,
      lastTurnCompletedAt: timestamp,
      lastVisitedAt: timestamp,
      failedAt: null,
      pinnedAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      doneOverride: null,
      doneAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    childThreads: [],
    messages: [
      {
        id: `message-${threadId}`,
        threadId,
        turnId: `turn-${threadId}`,
        role: "user",
        content,
        state: "complete",
        ordinal: 0,
        createdAt: timestamp,
      },
    ],
    activities: [],
    seq: 0,
  }
}

function readyView(
  state: ReturnType<typeof useThreadView>["state"]
): ThreadView {
  if (state.status !== "ready") throw new Error("Thread view is not ready")
  return state.data
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const unusedTransport: RuntimeTransport = {
  request: async () => {
    throw new Error("Unexpected transport request")
  },
  subscribe: () => () => {},
}
