import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { Artifact, TurnOutput } from "@deskto/protocol"

/**
 * Lets the conversation open a captured file without knowing how the task
 * panel routes its format. Page-like results may open in Browser; the rest
 * open in Files.
 */
type FilesAccess = {
  outputs: TurnOutput[]
  projectPath: string
  open: (artifactId: string) => void
  /**
   * Show these files together. The caller names the files rather than a
   * place: the Files view knows where it has to stand for all of them to be
   * in view, and the answer moves as the task writes into more folders.
   */
  openAll: (outputs: TurnOutput[]) => void
}

const FilesContext = createContext<FilesAccess | null>(null)

export function FilesProvider({
  outputs,
  projectPath,
  onOpen,
  onOpenAll,
  children,
}: {
  outputs: TurnOutput[]
  projectPath: string
  onOpen: (artifactId: string) => void
  onOpenAll: (outputs: TurnOutput[]) => void
  children: ReactNode
}) {
  const access = useMemo(
    () => ({ outputs, projectPath, open: onOpen, openAll: onOpenAll }),
    [outputs, projectPath, onOpen, onOpenAll]
  )
  return (
    <FilesContext.Provider value={access}>{children}</FilesContext.Provider>
  )
}

export function useFileActions(): Pick<FilesAccess, "open" | "openAll"> {
  const access = useContext(FilesContext)
  return access ?? { open: () => {}, openAll: () => {} }
}

/**
 * The Artifact behind a path an Activity reported, and the action that opens
 * it. Both are absent when the agent only read the file.
 */
export function useFileAt(path: string): {
  artifact: Artifact
  open: () => void
} | null {
  const access = useContext(FilesContext)
  if (!access) return null
  const artifact = matchFile(access.outputs, path, access.projectPath)
  if (!artifact) return null
  return { artifact, open: () => access.open(artifact.id) }
}

/**
 * Activities report paths the way the Harness wrote them: project-relative,
 * absolute, or occasionally with a `./` prefix. An absolute path inside the
 * Project is reduced against the Project root first, so it answers on the
 * exact pass rather than on a guess.
 *
 * The looser passes remain for paths the root cannot explain — a Harness
 * reporting through a symlinked or differently-cased root. They are guesses,
 * so they count only when exactly one Artifact fits; otherwise the chip would
 * open someone else's file. An ambiguous pass ends the search rather than
 * falling through, since a vaguer rule cannot resolve what a sharper one
 * could not.
 */
export function matchFile(
  outputs: TurnOutput[],
  path: string,
  projectPath: string
): Artifact | undefined {
  const wanted = withoutProjectRoot(
    path.replaceAll("\\", "/").replace(/^\.\//, ""),
    projectPath.replaceAll("\\", "/").replace(/\/+$/, "")
  )
  if (!wanted) return undefined

  const artifacts = outputs.map((output) => output.artifact)
  const exact = artifacts.find((artifact) => artifact.relativePath === wanted)
  if (exact) return exact

  const suffixed = artifacts.filter((artifact) =>
    wanted.endsWith(`/${artifact.relativePath}`)
  )
  if (suffixed.length === 1) return suffixed[0]
  if (suffixed.length > 1) return undefined

  const name = wanted.split("/").pop()
  const named = artifacts.filter((artifact) => artifact.name === name)
  return named.length === 1 ? named[0] : undefined
}

function withoutProjectRoot(path: string, root: string): string {
  if (!root || !path.startsWith(`${root}/`)) return path
  return path.slice(root.length + 1)
}
