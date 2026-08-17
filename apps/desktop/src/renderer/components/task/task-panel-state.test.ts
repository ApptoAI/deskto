// @vitest-environment jsdom

import { act } from "react"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  keepFolder,
  retainSelectedFile,
  selectFiles,
  showActivities,
  showFile,
  showBrowser,
  showFilesOverview,
  showFolder,
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
    act(() => showBrowser(threadId))
    expect(result.current).toEqual({
      surface: "browser",
      selectedArtifactId: "report",
      folderPath: "",
    })
    act(() => showActivities(threadId))
    expect(result.current).toEqual({
      surface: "activities",
      selectedArtifactId: "report",
      folderPath: "",
    })

    act(() => selectFiles(threadId))
    expect(result.current).toEqual({
      surface: "files",
      selectedArtifactId: "report",
      folderPath: "",
    })

    act(() => showActivities(threadId))
    act(() => retainSelectedFile(threadId, []))
    expect(result.current).toEqual({
      surface: "activities",
      folderPath: "",
    })
  })

  it("keeps the open folder while a file is read, and drops it for the overview", () => {
    const threadId = "panel-folder-thread"
    const { result } = renderHook(() => usePanelState(threadId))

    act(() => showFolder(threadId, "docs/adr"))
    act(() => showFile(threadId, "0014"))
    expect(result.current).toEqual({
      surface: "files",
      folderPath: "docs/adr",
      selectedArtifactId: "0014",
    })

    act(() => showFolder(threadId, "docs/adr"))
    expect(result.current).toEqual({
      surface: "files",
      folderPath: "docs/adr",
    })

    act(() => showFilesOverview(threadId))
    expect(result.current).toEqual({ surface: "files", folderPath: "" })
  })

  it("keeps the open folder when a file disappears from the task", () => {
    const threadId = "panel-folder-retain-thread"
    const { result } = renderHook(() => usePanelState(threadId))

    act(() => showFolder(threadId, "docs"))
    act(() => showFile(threadId, "guide"))
    act(() => retainSelectedFile(threadId, []))
    expect(result.current).toEqual({ surface: "files", folderPath: "docs" })
  })

  it("follows the panel to a new folder without closing what is open", () => {
    const threadId = "panel-folder-keep-thread"
    const { result } = renderHook(() => usePanelState(threadId))

    act(() => showFolder(threadId, "docs/adr"))
    act(() => showFile(threadId, "0014"))
    // The task emptied docs/adr while the file was open: the list falls back
    // to docs, and the fallback is remembered rather than worked out again,
    // so refilling docs/adr cannot pull the panel back down into it.
    act(() => keepFolder(threadId, "docs"))
    expect(result.current).toEqual({
      surface: "files",
      folderPath: "docs",
      selectedArtifactId: "0014",
    })

    act(() => showActivities(threadId))
    act(() => keepFolder(threadId, ""))
    expect(result.current).toEqual({
      surface: "activities",
      folderPath: "",
      selectedArtifactId: "0014",
    })
  })
})
