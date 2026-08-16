import { stat } from "node:fs/promises"
import { dirname, join, parse, resolve } from "node:path"

export async function projectSkillRootPaths(
  projectPath: string,
  relativeRoot: string
): Promise<string[]> {
  const start = resolve(projectPath)
  const repositoryRoot = await findRepositoryRoot(start)
  if (!repositoryRoot) return [join(start, relativeRoot)]

  const paths: string[] = []
  let current = start
  while (true) {
    paths.push(join(current, relativeRoot))
    if (current === repositoryRoot) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return paths
}

async function findRepositoryRoot(start: string): Promise<string | null> {
  const root = parse(start).root
  let current = start
  while (true) {
    if (await exists(join(current, ".git"))) return current
    if (current === root) return null
    current = dirname(current)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
