import { proseClassName } from "@workspace/ui/components/chat/markdown"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { z } from "zod"

import { InlineError } from "../inline-error.js"
import { documentMeasureClassName } from "./task-panel-size.js"
import { useWorkerResult } from "./use-worker-result.js"

export function DocumentPreview({ dataBase64 }: { dataBase64: string }) {
  const state = useWorkerResult(
    createDocumentWorker,
    dataBase64,
    documentWorkerSuccessSchema,
    sanitizeDocument,
    "Document worker failed",
    "Document preview worker returned unreadable data"
  )

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
    // No paper metaphor: a Word file is read here the same way a Markdown one
    // is, on the canvas and held to the same measure. A drop-shadowed white
    // sheet would be the one object in the app pretending to be physical.
    <ScrollArea className="flex-1">
      <article
        className={cn("mx-auto w-full px-8 py-8", documentMeasureClassName)}
      >
        {/* The same prose rules the agent's own output is set in, so a Word
            file and an answer are one voice rather than two. Only the images
            are added: a converted .docx is the one place here that carries
            them, and agent markdown never does. */}
        <div
          className={cn(
            proseClassName,
            "text-reading",
            "[&_img]:my-[1.2em] [&_img]:max-w-full [&_img]:rounded-lg"
          )}
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

type DocumentWorkerSuccess = { ok: true; html: string; warnings: number }
const documentWorkerSuccessSchema: z.ZodType<DocumentWorkerSuccess> = z.object({
  ok: z.literal(true),
  html: z.string(),
  warnings: z.number().int().nonnegative(),
})

function createDocumentWorker(): Worker {
  return new Worker(new URL("./document-worker.ts", import.meta.url), {
    type: "module",
  })
}

async function sanitizeDocument(result: DocumentWorkerSuccess) {
  const { default: DOMPurify } = await import("dompurify")
  return {
    html: DOMPurify.sanitize(result.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "iframe", "object", "embed", "script"],
      FORBID_ATTR: ["href"],
    }),
    warnings: result.warnings,
  }
}
