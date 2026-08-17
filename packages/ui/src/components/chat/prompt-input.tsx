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
        // The toolbar inside answers to this box, not to the window: the
        // conversation column narrows when the panel opens while the window
        // stays as wide as it was.
        "@container",
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
        // The ceiling is relative to the window as well as absolute: on a
        // short screen a fixed 16rem draft leaves the conversation a strip,
        // and a composer that owns half the window reads as the wrong thing
        // being in charge.
        "max-h-[min(16rem,30svh)] min-h-14 resize-none overflow-y-auto rounded-2xl border-0 bg-transparent px-4 py-3 text-base focus-visible:ring-0 md:text-sm dark:bg-transparent",
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
