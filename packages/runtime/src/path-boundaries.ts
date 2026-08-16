import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

/** Lexical containment for paths whose realpath policy is owned by the caller. */
export function pathIsWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  )
}

export function pathIsDirectChild(root: string, candidate: string): boolean {
  return dirname(resolve(candidate)) === resolve(root)
}
