import { useEffect, useState } from "react"

import { ScrollArea } from "@workspace/ui/components/scroll-area"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { InlineError } from "../inline-error.js"
import { base64ToArrayBuffer } from "./preview-bytes.js"

export function DocumentPreview({ dataBase64 }: { dataBase64: string }) {
  const [state, setState] = useState<
    QueryState<{ html: string; warnings: number }>
  >({ status: "loading" })

  useEffect(() => {
    let active = true
    let worker: Worker | undefined
    try {
      const createdWorker = new Worker(
        new URL("./document-worker.ts", import.meta.url),
        { type: "module" }
      )
      worker = createdWorker
      const data = base64ToArrayBuffer(dataBase64)
      createdWorker.onmessage = (event: MessageEvent<DocumentWorkerResult>) => {
        createdWorker.terminate()
        if (!active) return
        const result = event.data
        if (!result.ok) {
          setState({ status: "error", message: result.message })
          return
        }
        void import("dompurify").then(
          ({ default: DOMPurify }) => {
            if (!active) return
            setState({
              status: "ready",
              data: {
                html: DOMPurify.sanitize(result.html, {
                  USE_PROFILES: { html: true },
                  FORBID_TAGS: ["form", "iframe", "object", "embed", "script"],
                  FORBID_ATTR: ["href"],
                }),
                warnings: result.warnings,
              },
            })
          },
          (error: unknown) => {
            if (!active) return
            setState({
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            })
          }
        )
      }
      createdWorker.onerror = (event) => {
        createdWorker.terminate()
        if (!active) return
        setState({
          status: "error",
          message: event.message || "Document worker failed",
        })
      }
      createdWorker.onmessageerror = () => {
        createdWorker.terminate()
        if (!active) return
        setState({
          status: "error",
          message: "Document worker returned an unreadable result",
        })
      }
      createdWorker.postMessage(data, [data])
    } catch (error) {
      worker?.terminate()
      const message = error instanceof Error ? error.message : String(error)
      queueMicrotask(() => {
        if (active) setState({ status: "error", message })
      })
      return () => {
        active = false
      }
    }
    return () => {
      active = false
      worker?.terminate()
    }
  }, [dataBase64])

  if (state.status === "error") {
    return (
      <div className="p-3">
        <InlineError
          message={`Could not read this Word document. ${state.message}`}
        />
      </div>
    )
  }
  if (state.status !== "ready") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Reading document…
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 bg-muted/20">
      <article className="mx-auto my-5 min-h-[calc(100%-2.5rem)] w-[min(48rem,calc(100%-2rem))] rounded-sm border border-border bg-background px-8 py-10 shadow-sm">
        <div
          className="text-sm leading-relaxed break-words [&_a]:text-muted-foreground [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:text-lg [&_h3]:font-medium [&_img]:my-4 [&_img]:max-w-full [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: state.data.html }}
        />
        {state.data.warnings > 0 ? (
          <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
            Some Word formatting could not be reproduced in the preview.
          </p>
        ) : null}
      </article>
    </ScrollArea>
  )
}

type DocumentWorkerResult =
  | { ok: true; html: string; warnings: number }
  | { ok: false; message: string }
