// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useNowMinute } from "./use-now-minute.js"

describe("useNowMinute", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("advances while the view remains mounted", () => {
    vi.useFakeTimers()
    vi.setSystemTime("2026-09-02T06:00:00.000Z")
    const { result } = renderHook(() => useNowMinute())
    expect(result.current).toBe("2026-09-02T06:00:00.000Z")

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(result.current).toBe("2026-09-02T06:01:00.000Z")
  })
})
