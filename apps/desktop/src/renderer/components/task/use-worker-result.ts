import { useEffect, useState } from "react"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { base64ToArrayBuffer } from "./preview-bytes.js"

type WorkerSuccess = { ok: true }
type WorkerFailure = { ok: false; message: string }

export function useWorkerResult<Message extends WorkerSuccess, Result>(
  createWorker: () => Worker,
  dataBase64: string,
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
      createdWorker.onmessage = (
        event: MessageEvent<Message | WorkerFailure>
      ) => {
        createdWorker.terminate()
        if (!active) return
        const result = event.data
        if (!result.ok) {
          setSnapshot({
            dataBase64,
            state: { status: "error", message: result.message },
          })
          return
        }
        void (async () => transform(result as Message))().then(
          (result) => {
            if (active) {
              setSnapshot({
                dataBase64,
                state: { status: "ready", data: result },
              })
            }
          },
          (error: unknown) => {
            if (!active) return
            setSnapshot({
              dataBase64,
              state: {
                status: "error",
                message:
                  error instanceof Error ? error.message : String(error),
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
      const message = error instanceof Error ? error.message : String(error)
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
    transform,
    unreadableResultMessage,
    workerFailureMessage,
  ])

  return snapshot.dataBase64 === dataBase64
    ? snapshot.state
    : { status: "loading" }
}
