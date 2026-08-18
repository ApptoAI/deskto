import { describe, expect, it } from "vitest"

import {
  executionProfileForHarness,
  type HarnessModel,
} from "./execution-profile.js"

const models: HarnessModel[] = [
  {
    id: "codex-sol",
    name: "Codex Sol",
    supportedEfforts: ["low", "high"],
    defaultEffort: "low",
    isDefault: true,
    supportedPermissionModes: ["approval-required", "auto"],
  },
]

describe("executionProfileForHarness", () => {
  it("restores the selected Harness profile instead of the last used one", () => {
    expect(
      executionProfileForHarness(models, "codex", {
        codex: {
          modelId: "codex-sol",
          effort: "high",
          permissionMode: "auto",
        },
        claude: {
          modelId: "claude-opus",
          effort: "high",
          permissionMode: "approval-required",
        },
      })
    ).toEqual({
      modelId: "codex-sol",
      effort: "high",
      permissionMode: "auto",
    })
  })
})
