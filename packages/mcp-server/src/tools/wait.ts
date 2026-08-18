import type { ThreadView } from "@deskto/protocol"

import type { RuntimeClient } from "../runtime-client.js"
import { caughtErrorSchema } from "./schemas.js"

export async function waitForThreads(
  client: RuntimeClient,
  ids: string[],
  timeoutSeconds: number
): Promise<{ completed: boolean; threads: ThreadView[] }> {
  const read = () =>
    Promise.all(
      ids.map((threadId) =>
        client.request({ method: "thread.get", params: { threadId } })
      )
    )
  const isTerminal = (view: ThreadView) =>
    view.thread.status === "failed" ||
    (view.thread.status === "idle" && view.thread.lastUserMessageAt !== null)

  return new Promise((resolve, reject) => {
    let settled = false
    let reading = false
    let recheck = false
    let timer: ReturnType<typeof setTimeout> | undefined = undefined
    let unsubscribe: () => void = () => undefined
    const finish = (result: { completed: boolean; threads: ThreadView[] }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(result)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      reject(error)
    }
    const check = async () => {
      if (settled) return
      if (reading) {
        recheck = true
        return
      }
      reading = true
      try {
        const views = await read()
        if (views.every(isTerminal)) finish({ completed: true, threads: views })
      } catch (error) {
        fail(caughtErrorSchema.parse(error))
      } finally {
        reading = false
        if (recheck && !settled) {
          recheck = false
          void check()
        }
      }
    }
    unsubscribe = client.transport.subscribe((event) => {
      if (
        (event.type === "thread.changed" || event.type === "thread.delta") &&
        ids.includes(event.threadId)
      ) {
        void check()
      }
    })
    timer = setTimeout(() => {
      void read().then(
        (threads) => finish({ completed: threads.every(isTerminal), threads }),
        (error) => fail(caughtErrorSchema.parse(error))
      )
    }, timeoutSeconds * 1_000)
    void check()
  })
}
