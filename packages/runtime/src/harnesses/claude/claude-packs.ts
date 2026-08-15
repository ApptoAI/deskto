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

import type { HarnessPromptReference, SkillRoot } from "@openappto/harness-sdk"

import { slugify } from "../../packs/pack-files.js"

/**
 * The Claude Agent SDK loads extra skills only through local plugins, so each
 * neutral skill root is wrapped in a generated plugin: a manifest plus a link
 * to the real skills directory. The wrapper is a Claude-only concern and
 * lives outside the pack, in the host-provided shims directory.
 */
export function claudePluginsFor(
  skillRoots: SkillRoot[],
  shimsRoot: string = defaultShimsRoot
): { type: "local"; path: string; skipMcpDiscovery: true }[] {
  const plugins = []
  for (const root of skillRoots) {
    try {
      plugins.push({
        type: "local" as const,
        path: ensurePluginShim(root, shimsRoot),
        // Packs deliver skills only for now; their MCP config stays inert.
        skipMcpDiscovery: true as const,
      })
    } catch (error) {
      console.warn(`Could not wrap pack "${root.name}" for Claude:`, error)
      continue
    }
  }
  return plugins
}

const defaultShimsRoot = join(tmpdir(), "appto-claude-packs")

/** Shim content derives only from the root, so one build per process suffices. */
const builtShims = new Set<string>()

function ensurePluginShim(root: SkillRoot, shimsRoot: string): string {
  const name = claudePluginName(root)
  const shim = join(shimsRoot, name)
  if (builtShims.has(shim)) return shim

  mkdirSync(join(shim, ".claude-plugin"), { recursive: true })
  writeFileSync(
    join(shim, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name, description: `Appto pack ${root.name}` })}\n`
  )
  ensureLink(join(shim, "skills"), root.path)
  builtShims.add(shim)
  return shim
}

/** Returns Claude's provider-qualified name for one selected Pack Skill. */
export function claudeSkillCommand(
  reference: Extract<HarnessPromptReference, { kind: "skill" }>,
  roots: SkillRoot[]
): string {
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
