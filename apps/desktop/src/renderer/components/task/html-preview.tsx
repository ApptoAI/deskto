import { useCallback } from "react"

import { useRuntimeQuery } from "../../runtime/use-runtime-query.js"
import { InlineError } from "../inline-error.js"

export function HtmlPreview({ content }: { content: string }) {
  const load = useCallback(async () => {
    const { default: DOMPurify } = await import("dompurify")
    return DOMPurify.sanitize(content, {
      WHOLE_DOCUMENT: true,
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        "base",
        "button",
        "embed",
        "form",
        "iframe",
        "input",
        "meta",
        "object",
        "script",
        "select",
        "textarea",
      ],
      FORBID_ATTR: ["href", "srcset"],
    })
  }, [content])
  const query = useRuntimeQuery(load)

  if (query.state.status === "error") {
    return (
      <div className="p-3">
        <InlineError
          message={`Could not render this page. ${query.state.message}`}
        />
      </div>
    )
  }
  if (query.state.status !== "ready") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Rendering page…
      </div>
    )
  }

  return (
    <iframe
      sandbox=""
      srcDoc={query.state.data}
      title="HTML file preview"
      className="size-full border-0 bg-white"
    />
  )
}
