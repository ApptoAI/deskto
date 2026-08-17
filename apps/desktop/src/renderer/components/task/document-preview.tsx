import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { z } from "zod"

import { InlineError } from "../inline-error.js"
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
