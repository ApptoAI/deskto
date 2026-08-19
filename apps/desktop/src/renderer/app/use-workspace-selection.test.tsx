// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { RuntimeClient } from "@deskto/client"
import type { RuntimeTransport, Selection, Workspace } from "@deskto/protocol"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RuntimeClientProvider } from "../runtime/runtime-client-context.js"
import { useWorkspaceSelection } from "./use-workspace-selection.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe("useWorkspaceSelection", () => {
  it("keeps the latest selection when writes finish out of order", async () => {
    const writes = [deferred<Selection>(), deferred<Selection>()]
    const client = runtimeClient({
      setSelection: vi
        .fn()
        .mockReturnValueOnce(writes[0]!.promise)
        .mockReturnValueOnce(writes[1]!.promise),
    })
    let errorCount = 0
    const runAction = <T,>(action: () => Promise<T>) => {
      void action().catch(() => {
        errorCount += 1
      })
    }
    const { result } = renderHook(
      () => useWorkspaceSelection(client, vi.fn(), runAction),
      { wrapper: runtimeWrapper(client) }
    )
    await waitFor(() =>
      expect(result.current.activeWorkspaceId).toBe("personal")
    )

    act(() => result.current.selectWorkspace("studio"))
    act(() => result.current.selectWorkspace("personal"))
    await act(async () => {
      writes[1]!.resolve({ lastWorkspaceId: "personal", lastProjectIds: {} })
    })
    await act(async () => {
      writes[0]!.resolve({ lastWorkspaceId: "studio", lastProjectIds: {} })
    })

    expect(result.current.activeWorkspaceId).toBe("personal")
    expect(errorCount).toBe(0)
  })

  it("reloads and reports a failed current selection write", async () => {
    const write = deferred<Selection>()
    const getSelection = vi.fn().mockResolvedValue({
      lastWorkspaceId: "personal",
      lastProjectIds: {},
    })
    const client = runtimeClient({
      getSelection,
      setSelection: vi.fn().mockReturnValue(write.promise),
    })
    let errorCount = 0
    const runAction = <T,>(action: () => Promise<T>) => {
      void action().catch(() => {
        errorCount += 1
      })
    }
    const { result } = renderHook(
      () => useWorkspaceSelection(client, vi.fn(), runAction),
      { wrapper: runtimeWrapper(client) }
    )
    await waitFor(() =>
      expect(result.current.activeWorkspaceId).toBe("personal")
    )

    act(() => result.current.selectWorkspace("studio"))
    expect(result.current.activeWorkspaceId).toBe("studio")
    await act(async () => write.reject(new Error("persist failed")))

    await waitFor(() =>
      expect(result.current.activeWorkspaceId).toBe("personal")
    )
    expect(getSelection).toHaveBeenCalledTimes(2)
    expect(errorCount).toBe(1)
  })
})

function runtimeClient(
  overrides: Partial<Pick<RuntimeClient, "getSelection" | "setSelection">> = {}
): RuntimeClient {
  const workspaces: Workspace[] = [
    workspace("personal", "Personal"),
    workspace("studio", "Studio"),
  ]
  const client = new RuntimeClient(unusedTransport)
  client.listWorkspaces = vi.fn().mockResolvedValue(workspaces)
  client.listProjects = vi.fn().mockResolvedValue([])
  client.getSelection =
    overrides.getSelection ??
    vi.fn().mockResolvedValue({
      lastWorkspaceId: "personal",
      lastProjectIds: {},
    })
  client.setSelection = overrides.setSelection ?? client.setSelection
  client.subscribe = vi.fn(() => () => {})
  return client
}

const unusedTransport: RuntimeTransport = {
  request: async () => {
    throw new Error("Unexpected transport request")
  },
  subscribe: () => () => {},
}

function runtimeWrapper(client: RuntimeClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RuntimeClientProvider client={client}>{children}</RuntimeClientProvider>
    )
  }
}

function workspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    color: "violet",
    icon: "home",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
