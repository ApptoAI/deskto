import DOMPurify from "dompurify"

export function HtmlPreview({ content }: { content: string }) {
  return (
    <iframe
      sandbox=""
      srcDoc={sanitizeHtmlPreview(content)}
      title="HTML file preview"
      className="size-full border-0 bg-white"
    />
  )
}

export function sanitizeHtmlPreview(content: string): string {
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
}
