import { ipcMain, type WebContents } from "electron"

import { runtimeEventSchema, runtimeRequestSchema } from "@deskto/protocol"
import type { Runtime } from "@deskto/runtime"

import {
  runtimeEventChannel,
  runtimeRequestChannel,
} from "../shared/channels.js"

export function registerRuntimeIpc(
  runtime: Runtime,
  webContents: WebContents
): () => void {
  const unsubscribe = runtime.subscribe((event) => {
    const parsed = runtimeEventSchema.safeParse(event)
    if (!parsed.success) return
    if (!webContents.isDestroyed()) webContents.send(runtimeEventChannel, parsed.data)
  })

  ipcMain.handle(runtimeRequestChannel, (_event, value) => {
    const parsed = runtimeRequestSchema.safeParse(value)
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "invalid-request",
          message: "The runtime request is invalid",
        },
      }
    }
    return runtime.request(parsed.data)
  })

  return () => {
    unsubscribe()
    ipcMain.removeHandler(runtimeRequestChannel)
  }
}
