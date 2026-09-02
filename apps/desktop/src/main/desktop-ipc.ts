import { constants, createWriteStream } from "node:fs"
import { lstat, open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { dialog, ipcMain, shell } from "electron"
import { z } from "zod"

import type { Runtime } from "@deskto/runtime"
import {
  cookieImportHostSchema,
  isPageLikeArtifactPreviewKind,
  type BrowserProfile,
  type Workspace,
} from "@deskto/protocol"

import type { BrowserManager } from "./browser/browser-manager.js"
import { maximumBrowserUrlLength } from "./browser/browser-url.js"
import {
  importCookies,
  listImportableProfiles,
} from "./cookie-import/cookie-import.js"

import {
  browserActionChannel,
  browserCancelSelectionChannel,
  browserClearProfileChannel,
  browserHideChannel,
  browserOpenProfileFolderChannel,
  browserProfilesChannel,
  browserNavigateChannel,
  browserOpenArtifactChannel,
  browserSelectElementChannel,
  browserShowChannel,
  browserStateChannel,
  cookieImportDiscoverChannel,
  cookieImportRunChannel,
  openExternalChannel,
  openFileChannel,
  openFolderChannel,
  pickPackArchiveChannel,
  pickPackChannel,
  pickProjectChannel,
  revealFileChannel,
  saveFileCopyChannel,
} from "../shared/channels.js"
import type {
  BrowserAction,
  BrowserBounds,
  CookieImportRequest,
  PickedProject,
  ResultRef,
} from "../shared/desktop-api.js"

const allowedExternalProtocols = new Set(["http:", "https:"])

const resultRefSchema: z.ZodType<ResultRef> = z.object({
  threadId: z.string().min(1),
  artifactId: z.string().min(1),
})

const threadIdSchema = z.string().min(1)
const workspaceIdSchema = z.string().min(1)
const browserBoundsSchema: z.ZodType<BrowserBounds> = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive().max(4_096),
  height: z.number().int().positive().max(4_096),
})
const browserActionSchema: z.ZodType<BrowserAction> = z.enum([
  "back",
  "forward",
  "reload",
])
const cookieImportRequestSchema: z.ZodType<CookieImportRequest> = z.object({
  profileId: z.string().min(1),
  workspaceId: workspaceIdSchema,
  hosts: z.array(cookieImportHostSchema).max(200),
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

export function registerDesktopIpc(
  runtime: Runtime,
  browser: BrowserManager
): void {
  async function existingBrowserThread(value: string): Promise<string> {
    const threadId = threadIdSchema.parse(value)
    const response = await runtime.request({
      method: "thread.get",
      params: { threadId },
    })
    if (!response.ok) throw new Error("That task is no longer available.")
    return threadId
  }

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

  ipcMain.handle(browserShowChannel, async (_event, threadId, bounds) =>
    browser.show(
      await existingBrowserThread(threadId),
      browserBoundsSchema.parse(bounds)
    )
  )
  ipcMain.handle(browserHideChannel, (_event, threadId): void => {
    browser.hide(threadIdSchema.parse(threadId))
  })
  ipcMain.handle(browserStateChannel, async (_event, threadId) =>
    browser.state(await existingBrowserThread(threadId))
  )
  ipcMain.handle(browserNavigateChannel, async (_event, threadId, url) =>
    browser.userNavigate(
      await existingBrowserThread(threadId),
      z.string().min(1).max(maximumBrowserUrlLength).parse(url)
    )
  )
  ipcMain.handle(browserActionChannel, async (_event, threadId, action) => {
    const id = await existingBrowserThread(threadId)
    const parsed = browserActionSchema.parse(action)
    if (parsed === "back") return browser.back(id)
    if (parsed === "forward") return browser.forward(id)
    return browser.reload(id)
  })
  ipcMain.handle(browserOpenArtifactChannel, async (_event, value) => {
    const ref = resultRefSchema.parse(value)
    return browser.openArtifact(ref.threadId, async () => {
      await existingBrowserThread(ref.threadId)
      const located = await runtime.request({
        method: "artifact.locate",
        params: ref,
      })
      if (
        !located.ok ||
        !isPageLikeArtifactPreviewKind(located.data.previewKind)
      ) {
        throw new Error("Only HTML and PDF files open in Browser.")
      }
      const preview = await runtime.request({
        method: "artifact.preview",
        params: ref,
      })
      if (!preview.ok) throw new Error(preview.error.message)
      if (located.data.previewKind === "html") {
        if (preview.data.kind !== "html") {
          throw new Error("That file is no longer available in this format.")
        }
        return {
          artifactId: ref.artifactId,
          name: located.data.name,
          kind: "html",
          body: preview.data.content,
        }
      }
      if (preview.data.kind !== "pdf") {
        throw new Error("That file is no longer available in this format.")
      }
      return {
        artifactId: ref.artifactId,
        name: located.data.name,
        kind: "pdf",
        body: Uint8Array.from(Buffer.from(preview.data.dataBase64, "base64")),
      }
    })
  })
  ipcMain.handle(browserSelectElementChannel, async (_event, threadId) =>
    browser.selectElement(await existingBrowserThread(threadId))
  )
  ipcMain.handle(browserCancelSelectionChannel, async (_event, threadId) =>
    browser.cancelElementSelection(await existingBrowserThread(threadId))
  )

  // A profile is only ever named through a Workspace the Runtime still has,
  // so the renderer cannot point the clear or open actions at a folder of
  // its own choosing.
  async function existingWorkspace(value: string): Promise<Workspace> {
    const workspaceId = workspaceIdSchema.parse(value)
    const response = await runtime.request({
      method: "workspace.list",
      params: {},
    })
    if (!response.ok) throw new Error(response.error.message)
    const workspace = response.data.find((entry) => entry.id === workspaceId)
    if (!workspace) throw new Error("That workspace is no longer available.")
    return workspace
  }

  ipcMain.handle(browserProfilesChannel, async (): Promise<BrowserProfile[]> => {
    const response = await runtime.request({
      method: "workspace.list",
      params: {},
    })
    if (!response.ok) throw new Error(response.error.message)
    return Promise.all(
      response.data.map(async (workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ...(await browser.profileUsage(workspace.id)),
      }))
    )
  })
  ipcMain.handle(browserClearProfileChannel, async (_event, workspaceId) =>
    browser.clearProfile((await existingWorkspace(workspaceId)).id)
  )
  ipcMain.handle(
    browserOpenProfileFolderChannel,
    async (_event, workspaceId): Promise<void> => {
      const workspace = await existingWorkspace(workspaceId)
      const folderPath = browser.profilePath(workspace.id)
      let entry
      try {
        entry = await stat(folderPath)
      } catch {
        throw new Error("This workspace has no browser data yet.")
      }
      if (!entry.isDirectory()) {
        throw new Error("This workspace has no browser data yet.")
      }
      const error = await shell.openPath(folderPath)
      if (error) throw new Error(error)
    }
  )

  ipcMain.handle(cookieImportDiscoverChannel, () => listImportableProfiles())
  ipcMain.handle(cookieImportRunChannel, async (_event, value) => {
    const request = cookieImportRequestSchema.parse(value)
    const workspace = await existingWorkspace(request.workspaceId)
    return importCookies(request, browser.cookieSink(workspace.id))
  })
}
