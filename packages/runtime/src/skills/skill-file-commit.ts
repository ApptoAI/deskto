import { randomUUID } from "node:crypto"
import * as filesystem from "node:fs/promises"
import { dirname, join } from "node:path"

import { RuntimeError } from "../errors.js"
import { openRegularFileWithinRoot } from "../safe-file-open.js"

type FileOperations = Pick<
  typeof filesystem,
  "writeFile" | "rename" | "link" | "rm"
>

type SkillFileCommit = {
  path: string
  root: string
  expectedContent: string
  content: string
  identity: { dev: number; ino: number; mode: number }
}

export async function commitSkillFile(
  input: SkillFileCommit,
  files: FileOperations = filesystem
): Promise<void> {
  const id = randomUUID()
  const temporary = join(dirname(input.path), `.SKILL-${id}.tmp`)
  const recovery = join(dirname(input.path), `.deskto-skill-${id}.recovery`)
  let displaced = false
  let published = false
  try {
    await files.writeFile(temporary, input.content, {
      flag: "wx",
      mode: input.identity.mode & 0o777,
    })
    // Moving the actual target preserves a replacement made after the caller's
    // read. A second read followed by overwriting rename cannot do that.
    await files.rename(input.path, recovery)
    displaced = true
    if (!(await matchesExpected(recovery, input))) throw conflict(recovery)
    await files.link(temporary, input.path)
    published = true
    if (!(await matchesExpected(recovery, input))) throw conflict(recovery)
    // Keep this inode: another editor can still write through an already-open
    // descriptor after either check. Portable Node has no conditional rename.
  } catch (error) {
    if (displaced && !published) {
      // An external editor may have recreated the target. Never replace it
      // during recovery; both versions remain reachable if linking fails.
      await files.link(recovery, input.path).catch(() => undefined)
    }
    if (displaced) throw conflict(recovery)
    throw error
  } finally {
    await files.rm(temporary, { force: true })
  }
}

async function matchesExpected(
  path: string,
  input: SkillFileCommit
): Promise<boolean> {
  const opened = await openRegularFileWithinRoot(path, input.root)
  try {
    return (
      opened.metadata.dev === input.identity.dev &&
      opened.metadata.ino === input.identity.ino &&
      opened.metadata.mode === input.identity.mode &&
      (await opened.handle.readFile("utf8")) === input.expectedContent
    )
  } finally {
    await opened.handle.close()
  }
}

function conflict(recovery: string): RuntimeError {
  return new RuntimeError(
    "skill-conflict",
    `This skill changed while saving. Reopen it before saving again. The displaced version is preserved at ${recovery}. Open the folder to compare or restore it.`
  )
}
