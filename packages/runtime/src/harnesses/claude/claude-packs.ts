import { createHash } from "node:crypto"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

/**
 * The Claude Agent SDK loads extra skills only through local plugins, so each
 * neutral skill root is wrapped in a generated plugin: a manifest plus a
 * symlink to the real skills directory. The wrapper is a Claude-only concern
 * and lives outside the pack, in a deterministic temp location.
 */
export function claudePluginsFor(
  skillRoots: string[]
): { type: "local"; path: string; skipMcpDiscovery: true }[] {
  const plugins = []
  for (const skillRoot of skillRoots) {
    try {
      plugins.push({
        type: "local" as const,
        path: ensurePluginShim(skillRoot),
        // Packs deliver skills only for now; their MCP config stays inert.
        skipMcpDiscovery: true as const,
      })
    } catch {
      continue
    }
  }
  return plugins
}

function ensurePluginShim(skillRoot: string): string {
  const packName = basename(dirname(skillRoot))
  const name = `${slugify(packName) || "pack"}-${fingerprint(skillRoot)}`
  const shim = join(tmpdir(), "appto-claude-packs", name)

  mkdirSync(join(shim, ".claude-plugin"), { recursive: true })
  writeFileSync(
    join(shim, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name, description: `Appto pack ${packName}` })}\n`
  )
  const link = join(shim, "skills")
  rmSync(link, { force: true })
  symlinkSync(skillRoot, link, "dir")
  return shim
}

function fingerprint(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 8)
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
