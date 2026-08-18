import MousePointer2Icon from "lucide-react/dist/esm/icons/mouse-pointer-2"
import XIcon from "lucide-react/dist/esm/icons/x"
import type { BrowserElementContext } from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"

function contextLabel(context: BrowserElementContext): string {
  return (
    context.name?.trim() ||
    context.text?.trim() ||
    context.role?.trim() ||
    context.tagName
  )
}

export function BrowserContextAttachments({
  contexts,
  onRemove,
}: {
  contexts: readonly BrowserElementContext[]
  onRemove: (id: string) => void
}) {
  if (contexts.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {contexts.map((context, index) => {
        const label = contextLabel(context)
        const page = context.source.title || context.source.url
        return (
          <div
            key={context.id}
            className="group/context flex max-w-64 min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/60 py-1.5 pr-1.5 pl-2 text-xs"
            title={`${page}\n${context.selector}`}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-[10px] font-semibold text-primary">
              {index + 1}
            </span>
            <MousePointer2Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{label}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={() => onRemove(context.id)}
              aria-label={`Remove selected page element ${index + 1}: ${label}`}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
