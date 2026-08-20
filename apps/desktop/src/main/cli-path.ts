import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

/**
 * GUI applications inherit a minimal PATH. Build on it with the documented
 * native installer locations and common package-manager shims without
 * executing the person's shell profiles during application startup.
 */
export async function configureCliPath(
  homeDirectory = homedir()
): Promise<void> {
  const inherited = process.env.PATH?.split(path.delimiter) ?? []
  const versionedNodeBins = await discoverVersionedNodeBins(homeDirectory)
  process.env.PATH = [
    ...new Set([
      ...inherited,
      ...fixedBinDirectories(homeDirectory),
      ...versionedNodeBins,
    ]),
  ].join(path.delimiter)
}

function fixedBinDirectories(homeDirectory: string): string[] {
  const directories = [
    path.join(homeDirectory, ".local/bin"),
    path.join(homeDirectory, ".npm-global/bin"),
    path.join(homeDirectory, ".volta/bin"),
    path.join(homeDirectory, ".asdf/shims"),
    path.join(homeDirectory, ".nodenv/shims"),
    path.join(homeDirectory, ".local/share/mise/shims"),
    path.join(homeDirectory, ".local/share/pnpm"),
    path.join(homeDirectory, ".bun/bin"),
    path.join(homeDirectory, ".deno/bin"),
    path.join(homeDirectory, ".cargo/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
  if (process.platform === "darwin") {
    directories.push(path.join(homeDirectory, "Library/pnpm"))
  }
  return directories
}

async function discoverVersionedNodeBins(
  homeDirectory: string
): Promise<string[]> {
  const roots = [
    {
      path: path.join(homeDirectory, ".nvm/versions/node"),
      suffix: ["bin"],
    },
    {
      path: path.join(homeDirectory, ".fnm/node-versions"),
      suffix: ["installation", "bin"],
    },
    {
      path: path.join(homeDirectory, ".local/share/fnm/node-versions"),
      suffix: ["installation", "bin"],
    },
  ]
  if (process.platform === "darwin") {
    roots.push({
      path: path.join(
        homeDirectory,
        "Library/Application Support/fnm/node-versions"
      ),
      suffix: ["installation", "bin"],
    })
  }

  const discovered = await Promise.all(
    roots.map(async (root) => {
      const entries = await readdir(root.path, { withFileTypes: true }).catch(
        () => []
      )
      return entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort((left, right) =>
          right.localeCompare(left, undefined, { numeric: true })
        )
        .map((name) => path.join(root.path, name, ...root.suffix))
    })
  )
  return discovered.flat()
}
