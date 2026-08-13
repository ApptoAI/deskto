import { ipcMain, type WebContents } from "electron"

import { runtimeRequestSchema } from "@openappto/protocol"
import type { Runtime } from "@openappto/runtime"

import {
  runtimeEventChannel,
  runtimeRequestChannel,
} from "../shared/channels.js"

export function registerRuntimeIpc(
  runtime: Runtime,
  webContents: WebContents
): () => void {
  const unsubscribe = runtime.subscribe((event) => {
    if (!webContents.isDestroyed()) webContents.send(runtimeEventChannel, event)
  })

  ipcMain.handle(runtimeRequestChannel, (_event, value: unknown) => {
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
