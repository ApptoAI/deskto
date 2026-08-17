// @vitest-environment jsdom

import { act } from "react"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  retainSelectedFile,
  selectFiles,
  showActivities,
  showFile,
  usePanelState,
} from "./task-panel-state.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(cleanup)

describe("task panel state", () => {
  it("keeps selection across surfaces and never changes surface on refresh", () => {
    const threadId = "panel-state-thread"
    const { result } = renderHook(() => usePanelState(threadId))

    act(() => showFile(threadId, "report"))
    act(() => showActivities(threadId))
    expect(result.current).toEqual({
      surface: "activities",
      selectedArtifactId: "report",
    })

    act(() => selectFiles(threadId))
    expect(result.current).toEqual({
      surface: "files",
      selectedArtifactId: "report",
    })

    act(() => showActivities(threadId))
    act(() => retainSelectedFile(threadId, []))
    expect(result.current).toEqual({ surface: "activities" })
  })
})
