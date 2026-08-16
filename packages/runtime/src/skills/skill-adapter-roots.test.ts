import { homedir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { ClaudeAdapter } from "../harnesses/claude/claude-adapter.js"
import { CodexAdapter } from "../harnesses/codex/codex-adapter.js"

describe("built-in skill discovery roots", () => {
  it("uses the current personal skill locations", async () => {
    const [claude, codex] = await Promise.all([
      new ClaudeAdapter().discoverSkillRoots({ projectPath: null }),
      new CodexAdapter().discoverSkillRoots({ projectPath: null }),
    ])

    expect(claude).toContainEqual({
      path: join(homedir(), ".claude", "skills"),
      scope: "user",
      label: "Claude Code personal skills",
    })
    expect(codex).toContainEqual({
      path: join(homedir(), ".agents", "skills"),
      scope: "user",
      label: "Codex personal skills",
    })
  })
})
