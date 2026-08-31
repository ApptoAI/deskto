// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { useRuntimeQuery } from "./use-runtime-query.js"

afterEach(cleanup)

describe("useRuntimeQuery", () => {
  it("keeps initial data visible while refreshing it", () => {
    const neverResolves = () => new Promise<string>(() => {})
    const { result } = renderHook(() =>
      useRuntimeQuery(neverResolves, "prefetched task")
    )

    expect(result.current.state).toEqual({
      status: "ready",
      data: "prefetched task",
    })
  })
})
