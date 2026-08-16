import { constants, createWriteStream } from "node:fs"
import { lstat, open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { dialog, ipcMain, shell } from "electron"
import { z } from "zod"

import type { Runtime } from "@deskto/runtime"

import {
  openExternalChannel,
  openFileChannel,
  openFolderChannel,
  pickPackArchiveChannel,
  pickPackChannel,
  pickProjectChannel,
  revealFileChannel,
  saveFileCopyChannel,
} from "../shared/channels.js"
import type { PickedProject, ResultRef } from "../shared/desktop-api.js"

const allowedExternalProtocols = new Set(["http:", "https:"])

const resultRefSchema: z.ZodType<ResultRef> = z.object({
  threadId: z.string().min(1),
  artifactId: z.string().min(1),
})

function handleFolderPick(channel: string, title: string): void {
  ipcMain.handle(channel, async (): Promise<PickedProject | undefined> => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title,
    })
    const selectedPath = result.filePaths[0]
    if (result.canceled || !selectedPath) return undefined

    return { path: selectedPath, name: path.basename(selectedPath) }
  })
}

export function registerDesktopIpc(runtime: Runtime): void {
  handleFolderPick(pickProjectChannel, "Open project folder")
  handleFolderPick(pickPackChannel, "Choose a pack folder")
  ipcMain.handle(
    pickPackArchiveChannel,
    async (): Promise<PickedProject | undefined> => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        title: "Choose a Pack ZIP",
        filters: [{ name: "ZIP archives", extensions: ["zip"] }],
      })
      const selectedPath = result.filePaths[0]
      if (result.canceled || !selectedPath) return undefined
      return { path: selectedPath, name: path.basename(selectedPath) }
    }
  )

  /**
   * File actions name a result, never a path. The renderer cannot say which
   * file to touch: main asks the Runtime, which resolves the artifact inside
   * its Project and refuses anything that escapes it. A renderer holding an
   * arbitrary path has nothing to do with it.
   */
  async function resolveResult(ref: ResultRef) {
    const response = await runtime.request({
      method: "artifact.locate",
      params: ref,
    })
    if (!response.ok) throw new Error(response.error.message)

    const entry = await lstat(response.data.absolutePath).catch(() => undefined)
    const currentPath = await realpath(response.data.absolutePath).catch(
      () => undefined
    )
    if (
      !entry?.isFile() ||
      currentPath !== response.data.absolutePath ||
      String(entry.dev) !== response.data.device ||
      String(entry.ino) !== response.data.inode
    ) {
      throw new Error("That file is no longer available.")
    }
    return response.data
  }

  /**
   * Opens the same inode the Runtime checked. Holding the descriptor keeps a
   * save-copy action on that file even if the project path changes while the
   * system dialog is open.
   */
  async function openResult(ref: ResultRef) {
    const result = await resolveResult(ref)
    const handle = await open(
      result.absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    try {
      const entry = await handle.stat()
      if (
        !entry.isFile() ||
        String(entry.dev) !== result.device ||
        String(entry.ino) !== result.inode
      ) {
        throw new Error("That file changed while it was being opened.")
      }
      return { result, handle }
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  // Directories only: shell.openPath on a file would hand it to whatever
  // app claims that type, so a stray path could launch something. A folder
  // just opens the file manager.
  ipcMain.handle(openFolderChannel, async (_event, value): Promise<void> => {
    const parsed = z.string().safeParse(value)
    if (!parsed.success || !path.isAbsolute(parsed.data)) {
      throw new Error("The project folder path is invalid.")
    }
    const folderPath = parsed.data

    let entry
    try {
      entry = await stat(folderPath)
    } catch {
      throw new Error("The project folder is not available.")
    }
    if (!entry.isDirectory()) {
      throw new Error("The project path is not a folder.")
    }

    const error = await shell.openPath(folderPath)
    if (error) {
      throw new Error(error)
    }
  })

  // Opening a file hands it to whatever application claims its type, so the
  // Runtime's format allowlist decides. Documents only: an agent can write an
  // executable into a Project as easily as a report.
  ipcMain.handle(openFileChannel, async (_event, value): Promise<void> => {
    const opened = await openResult(resultRefSchema.parse(value))
    try {
      if (!opened.result.openable) {
        throw new Error("This file type cannot be opened from Deskto.")
      }
      const currentPath = await realpath(opened.result.absolutePath)
      if (currentPath !== opened.result.absolutePath) {
        throw new Error("That file changed while it was being opened.")
      }
      const error = await shell.openPath(opened.result.absolutePath)
      if (error) throw new Error(error)
    } finally {
      await opened.handle.close()
    }
  })

  // Revealing only selects the file in the file manager, so it needs no
  // format restriction.
  ipcMain.handle(revealFileChannel, async (_event, value): Promise<void> => {
    const opened = await openResult(resultRefSchema.parse(value))
    try {
      const currentPath = await realpath(opened.result.absolutePath)
      if (currentPath !== opened.result.absolutePath) {
        throw new Error("That file changed while it was being revealed.")
      }
      shell.showItemInFolder(opened.result.absolutePath)
    } finally {
      await opened.handle.close()
    }
  })

  ipcMain.handle(
    saveFileCopyChannel,
    async (_event, value, suggestedName): Promise<boolean> => {
      const name = z.string().min(1).safeParse(suggestedName)
      const dialogResult = await dialog.showSaveDialog({
        title: "Save a copy",
        defaultPath: name.success ? name.data : undefined,
      })
      if (dialogResult.canceled || !dialogResult.filePath) return false

      const opened = await openResult(resultRefSchema.parse(value))
      try {
        if (
          path.resolve(dialogResult.filePath) === opened.result.absolutePath
        ) {
          throw new Error("Choose a different location for the copy.")
        }
        await pipeline(
          opened.handle.createReadStream({ autoClose: false }),
          createWriteStream(dialogResult.filePath)
        )
        return true
      } finally {
        await opened.handle.close()
      }
    }
  )

  ipcMain.handle(openExternalChannel, async (_event, value): Promise<void> => {
    const parsed = z.string().safeParse(value)
    if (!parsed.success) return

    try {
      const url = new URL(parsed.data)
      if (!allowedExternalProtocols.has(url.protocol)) return
      await shell.openExternal(url.toString())
    } catch {
      return
    }
  })
}
