import { copyFile, stat } from "node:fs/promises"
import path from "node:path"

import { dialog, ipcMain, shell } from "electron"
import { z } from "zod"

import type { Runtime } from "@deskto/runtime"

import {
  openExternalChannel,
  openFileChannel,
  openFolderChannel,
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

    const entry = await stat(response.data.absolutePath).catch(() => undefined)
    if (!entry?.isFile()) {
      throw new Error("That file is no longer available.")
    }
    return response.data
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
    const result = await resolveResult(resultRefSchema.parse(value))
    if (!result.openable) {
      throw new Error("This file type cannot be opened from Deskto.")
    }

    const error = await shell.openPath(result.absolutePath)
    if (error) throw new Error(error)
  })

  // Revealing only selects the file in the file manager, so it needs no
  // format restriction.
  ipcMain.handle(revealFileChannel, async (_event, value): Promise<void> => {
    const result = await resolveResult(resultRefSchema.parse(value))
    shell.showItemInFolder(result.absolutePath)
  })

  ipcMain.handle(
    saveFileCopyChannel,
    async (_event, value, suggestedName): Promise<boolean> => {
      const result = await resolveResult(resultRefSchema.parse(value))
      const name = z.string().min(1).safeParse(suggestedName)
      const dialogResult = await dialog.showSaveDialog({
        title: "Save a copy",
        defaultPath: name.success
          ? name.data
          : path.basename(result.absolutePath),
      })
      if (dialogResult.canceled || !dialogResult.filePath) return false

      await copyFile(result.absolutePath, dialogResult.filePath)
      return true
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
