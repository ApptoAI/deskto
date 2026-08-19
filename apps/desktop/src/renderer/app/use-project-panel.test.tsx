// @vitest-environment jsdom

import { act } from "react"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { useProjectPanel } from "./use-project-panel.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe("useProjectPanel", () => {
  it("opens the requested project after the active project changes", () => {
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useProjectPanel(projectId),
      { initialProps: { projectId: "draft-project" } }
    )

    act(() => result.current.forceOpen("sidebar-project"))
    rerender({ projectId: "sidebar-project" })

    expect(result.current.preference).toBe("open")
  })
})
