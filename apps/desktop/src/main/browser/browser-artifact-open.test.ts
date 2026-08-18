import { describe, expect, it } from "vitest"

import { BrowserArtifactOpenRequests } from "./browser-artifact-open.js"

describe("Browser Artifact open requests", () => {
  it("lets the latest request win independently in each Task", () => {
    const requests = new BrowserArtifactOpenRequests()
    const first = requests.begin("thread-1")
    const otherThread = requests.begin("thread-2")
    const latest = requests.begin("thread-1")

    expect(requests.isCurrent(first)).toBe(false)
    expect(requests.isCurrent(latest)).toBe(true)
    expect(requests.isCurrent(otherThread)).toBe(true)

    requests.invalidate("thread-2")
    expect(requests.isCurrent(otherThread)).toBe(false)

    requests.finish(first)
    expect(requests.isCurrent(latest)).toBe(true)
    requests.finish(latest)
    expect(requests.isCurrent(latest)).toBe(false)

    const cleared = requests.begin("thread-3")
    requests.clear("thread-3")
    expect(requests.isCurrent(cleared)).toBe(false)
  })
})
