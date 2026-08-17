import { useEffect, useMemo, useRef } from "react"

import { base64ToArrayBuffer } from "./preview-bytes.js"
import { PreviewFailure } from "./preview-states.js"

/**
 * The bytes become a short-lived blob URL handed to Chromium's own PDF
 * viewer, which brings paging, zoom, search, and printing with it.
 *
 * The viewer only attaches to an embedded object that already carries its
 * source, so the element is built in the effect rather than rendered with a
 * source React fills in later. That also ties the blob URL to the element's
 * lifetime: it is revoked as soon as the tab closes.
 */
export function PdfPreview({ dataBase64 }: { dataBase64: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const decoded = useMemo(() => {
    try {
      return {
        ok: true as const,
        bytes: new Uint8Array(base64ToArrayBuffer(dataBase64)),
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }, [dataBase64])
  const bytes = decoded.ok ? decoded.bytes : undefined

  useEffect(() => {
    const host = hostRef.current
    if (!bytes || !host) return

    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" })
    )
    const embed = document.createElement("embed")
    embed.type = "application/pdf"
    embed.src = url
    embed.className = "size-full border-0 bg-white"
    embed.setAttribute("aria-label", "PDF file preview")
    host.append(embed)

    return () => {
      embed.remove()
      URL.revokeObjectURL(url)
    }
  }, [bytes])

  if (!decoded.ok) {
    return (
      <PreviewFailure message={`Could not read this PDF. ${decoded.message}`} />
    )
  }

  return <div ref={hostRef} className="min-h-0 flex-1" />
}
