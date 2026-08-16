import { useEffect, useState } from "react"
import { z } from "zod"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { describedErrorSchema } from "../../runtime/describe-error.js"
import { base64ToArrayBuffer } from "./preview-bytes.js"

type WorkerSuccess = { ok: true }
const workerFailureSchema = z.object({
  ok: z.literal(false),
  message: z.string(),
})

export function useWorkerResult<Message extends WorkerSuccess, Result>(
  createWorker: () => Worker,
  dataBase64: string,
  messageSchema: z.ZodType<Message>,
  transform: (message: Message) => Result | Promise<Result>,
  workerFailureMessage: string,
  unreadableResultMessage: string
): QueryState<Result> {
  const [snapshot, setSnapshot] = useState<{
    dataBase64: string
    state: QueryState<Result>
  }>(() => ({ dataBase64, state: { status: "loading" } }))

  if (snapshot.dataBase64 !== dataBase64) {
    setSnapshot({ dataBase64, state: { status: "loading" } })
  }

  useEffect(() => {
    let active = true
    let worker: Worker | undefined
    try {
      const createdWorker = createWorker()
      worker = createdWorker
      const data = base64ToArrayBuffer(dataBase64)
      createdWorker.onmessage = (event: MessageEvent) => {
        createdWorker.terminate()
        if (!active) return
        const failure = workerFailureSchema.safeParse(event.data)
        if (failure.success) {
          setSnapshot({
            dataBase64,
            state: { status: "error", message: failure.data.message },
          })
          return
        }
        const message = messageSchema.safeParse(event.data)
        if (!message.success) {
          setSnapshot({
            dataBase64,
            state: { status: "error", message: unreadableResultMessage },
          })
          return
        }
        void (async () => transform(message.data))().then(
          (result) => {
            if (active) {
              setSnapshot({
                dataBase64,
                state: { status: "ready", data: result },
              })
            }
          },
          (error) => {
            if (!active) return
            setSnapshot({
              dataBase64,
              state: {
                status: "error",
                message: describedErrorSchema.parse(error),
              },
            })
          }
        )
      }
      createdWorker.onerror = (event) => {
        createdWorker.terminate()
        if (!active) return
        setSnapshot({
          dataBase64,
          state: {
            status: "error",
            message: event.message || workerFailureMessage,
          },
        })
      }
      createdWorker.onmessageerror = () => {
        createdWorker.terminate()
        if (!active) return
        setSnapshot({
          dataBase64,
          state: { status: "error", message: unreadableResultMessage },
        })
      }
      createdWorker.postMessage(data, [data])
    } catch (error) {
      worker?.terminate()
      const message = describedErrorSchema.parse(error)
      queueMicrotask(() => {
        if (active) {
          setSnapshot({
            dataBase64,
            state: { status: "error", message },
          })
        }
      })
      return () => {
        active = false
      }
    }
    return () => {
      active = false
      worker?.terminate()
    }
  }, [
    createWorker,
    dataBase64,
    messageSchema,
    transform,
    unreadableResultMessage,
    workerFailureMessage,
  ])

  return snapshot.dataBase64 === dataBase64
    ? snapshot.state
    : { status: "loading" }
}
