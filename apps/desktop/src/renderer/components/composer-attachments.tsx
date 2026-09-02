import XIcon from "lucide-react/dist/esm/icons/x"
import type { UploadImageAttachment } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

export function ComposerAttachments({
  attachments,
  preparingCount,
  onRemove,
}: {
  attachments: UploadImageAttachment[]
  preparingCount: number
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0 && preparingCount === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group/image relative size-16 overflow-hidden rounded-lg border border-border bg-muted"
        >
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            className="size-full object-cover"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute top-1 right-1 size-6 opacity-0 shadow-sm group-hover/image:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      ))}
      {preparingCount > 0 ? (
        <div
          role="status"
          className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-2 text-center text-xs text-muted-foreground"
        >
          Preparing…
        </div>
      ) : null}
    </div>
  )
}
