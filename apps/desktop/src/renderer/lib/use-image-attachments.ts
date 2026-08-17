import { useCallback, useRef, useState } from "react"
import type { UploadImageAttachment } from "@deskto/protocol"

import { describedErrorSchema } from "../runtime/describe-error.js"
import {
  prepareImageAttachment,
  selectImageFiles,
} from "./image-attachments.js"

export function useImageAttachments({
  disabled,
  onError,
}: {
  disabled: boolean
  onError: (message: string | null) => void
}) {
  const [attachments, setAttachments] = useState<UploadImageAttachment[]>([])
  const [preparingCount, setPreparingCount] = useState(0)
  const attachmentsRef = useRef<UploadImageAttachment[]>([])
  const pendingCount = useRef(0)

  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled) return
      const selection = selectImageFiles(
        files,
        attachmentsRef.current.length + pendingCount.current
      )
      onError(selection.error ?? null)
      if (selection.accepted.length === 0) return

      pendingCount.current += selection.accepted.length
      setPreparingCount((count) => count + selection.accepted.length)
      const results = await Promise.allSettled(
        selection.accepted.map(prepareImageAttachment)
      )
      const prepared = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      )
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )
      if (failure) onError(describedErrorSchema.parse(failure.reason))
      if (prepared.length > 0) {
        setAttachments((current) => {
          const next = [...current, ...prepared]
          attachmentsRef.current = next
          return next
        })
      }
      pendingCount.current -= selection.accepted.length
      setPreparingCount((count) => count - selection.accepted.length)
    },
    [disabled, onError]
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== id)
      attachmentsRef.current = next
      return next
    })
  }, [])

  const discardAttachments = useCallback((ids: ReadonlySet<string>) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => !ids.has(attachment.id))
      attachmentsRef.current = next
      return next
    })
  }, [])

  return {
    attachments,
    preparingCount,
    addFiles,
    removeAttachment,
    discardAttachments,
  }
}
