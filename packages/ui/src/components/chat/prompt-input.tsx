import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Textarea } from "@workspace/ui/components/textarea"

function PromptInput({ className, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      data-slot="prompt-input"
      className={cn(
        // A hairline and a raised surface, no shadow: a soft drop under a grey
        // well reads as smudge on a light canvas, and as nothing on a dark one.
        "flex w-full flex-col rounded-2xl bg-card pb-2 ring-1 ring-border transition-shadow duration-200 ease-out focus-within:ring-ring",
        className
      )}
      {...props}
    />
  )
}

/** Enter submits the surrounding form, Shift+Enter inserts a newline. */
function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="prompt-input-textarea"
      className={cn(
        "max-h-64 min-h-14 resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-4 py-3 text-base focus-visible:ring-0 md:text-sm dark:bg-transparent",
        className
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.defaultPrevented) return
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.nativeEvent.isComposing
        )
          return

        event.preventDefault()
        event.currentTarget.form?.requestSubmit()
      }}
      {...props}
    />
  )
}

function PromptInputToolbar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-input-toolbar"
      className={cn("flex items-center gap-2 px-2", className)}
      {...props}
    />
  )
}

export { PromptInput, PromptInputTextarea, PromptInputToolbar }
