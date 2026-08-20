import { describe, expect, it } from "vitest"

import { RuntimeClient } from "../runtime-client.js"
import { artifactRuntime, fakeRuntime, testBinding } from "../test-fixtures.js"
import { loadWorkspaceDependenciesTool } from "./load-workspace-dependencies.js"

describe("load_workspace_dependencies", () => {
  it("returns only the prevalidated runtime paths", async () => {
    const result = await loadWorkspaceDependenciesTool.handler(
      {},
      {
        client: new RuntimeClient(fakeRuntime()),
        binding: testBinding,
        artifactRuntime,
      }
    )

    expect(result.structuredContent).toEqual(artifactRuntime)
  })

  it("fails clearly when the host has no artifact runtime", async () => {
    await expect(
      loadWorkspaceDependenciesTool.handler(
        {},
        { client: new RuntimeClient(fakeRuntime()), binding: testBinding }
      )
    ).rejects.toThrow("preinstalled artifact runtime is unavailable")
  })
})
