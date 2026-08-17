import { createHash } from "node:crypto"
import {
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, sep } from "node:path"

import type {
  HarnessPromptReference,
  SkillProvisioningResult,
  SkillRoot,
} from "@deskto/harness-sdk"

import { slugify } from "../../packs/pack-files.js"

type ClaudeLocalPlugin = {
  type: "local"
  path: string
  skipMcpDiscovery: true
}

type ClaudePluginProvisioning = {
  plugins: ClaudeLocalPlugin[]
  results: SkillProvisioningResult[]
}

/**
 * The Claude Agent SDK loads extra skills only through local plugins, so each
 * neutral skill root is wrapped in a generated plugin: a manifest plus a link
 * to the real skills directory. The wrapper is a Claude-only concern and
 * lives outside the pack, in the host-provided shims directory.
 */
export function claudePluginsFor(
  skillRoots: SkillRoot[],
  shimsRoot: string = defaultShimsRoot
): ClaudeLocalPlugin[] {
  return provisionClaudePlugins(skillRoots, shimsRoot).plugins
}

export function provisionClaudePlugins(
  skillRoots: SkillRoot[],
  shimsRoot: string = defaultShimsRoot
): ClaudePluginProvisioning {
  const plugins: ClaudeLocalPlugin[] = []
  const results: SkillProvisioningResult[] = []
  for (const root of skillRoots) {
    try {
      plugins.push({
        type: "local",
        path: ensurePluginShim(root, shimsRoot),
        // Packs deliver skills only for now; their MCP config stays inert.
        skipMcpDiscovery: true,
      })
      results.push(claudeProvisioning(root, "configured"))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push(claudeProvisioning(root, "failed", message))
    }
  }
  return { plugins, results }
}

const defaultShimsRoot = join(tmpdir(), "deskto-claude-packs")

/** Shim content derives only from the root, so one build per process suffices. */
const builtShims = new Set<string>()

function ensurePluginShim(root: SkillRoot, shimsRoot: string): string {
  const name = claudePluginName(root)
  const shim = join(shimsRoot, name)
  if (builtShims.has(shim)) return shim

  mkdirSync(join(shim, ".claude-plugin"), { recursive: true })
  writeFileSync(
    join(shim, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name, description: `Deskto pack ${root.name}` })}\n`
  )
  ensureLink(join(shim, "skills"), root.path)
  builtShims.add(shim)
  return shim
}

/**
 * The slash command for one selected Skill. A Pack skill reaches Claude
 * through a generated plugin, so it carries that plugin's name; a skill that
 * already lives in Claude's own skills folder is its own command.
 */
export function claudeSkillCommand(
  reference: Extract<HarnessPromptReference, { kind: "skill" }>,
  roots: SkillRoot[]
): string {
  if (reference.origin === "native") return `/${reference.name}`
  const root = roots
    .filter((candidate) => containsPath(candidate.path, reference.path))
    .sort((left, right) => right.path.length - left.path.length)[0]
  if (!root) {
    throw new Error(
      `Selected Skill '${reference.name}' is outside the active Pack roots`
    )
  }
  return `/${claudePluginName(root)}:${reference.name}`
}

function containsPath(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  )
}

function claudePluginName(root: SkillRoot): string {
  return `${slugify(root.name) || "pack"}-${fingerprint(root.path)}`
}

/**
 * Idempotent and race-tolerant: concurrent turn starts may build the same
 * shim, so an existing link that already points at the target is success.
 * "junction" works on Windows without Developer Mode and is ignored elsewhere.
 */
function ensureLink(link: string, target: string): void {
  if (currentTarget(link) === target) return
  rmSync(link, { force: true, recursive: true })
  try {
    symlinkSync(target, link, "junction")
  } catch (error) {
    if (currentTarget(link) !== target) throw error
  }
}

function currentTarget(link: string): string | null {
  try {
    return readlinkSync(link)
  } catch {
    return null
  }
}

function fingerprint(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 8)
}

function claudeProvisioning(
  root: SkillRoot,
  status: SkillProvisioningResult["status"],
  message?: string
): SkillProvisioningResult {
  const result: SkillProvisioningResult = {
    rootId: root.id ?? root.path,
    rootPath: root.path,
    status,
    method: "plugin-shim",
  }
  if (root.contentDigest) result.contentDigest = root.contentDigest
  if (message) result.message = message
  return result
}
