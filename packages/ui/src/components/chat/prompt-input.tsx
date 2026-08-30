import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Textarea } from "@workspace/ui/components/textarea"

function PromptInput({ className, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      data-slot="prompt-input"
      className={cn(
        // The composer is the one surface that reads as lifted off the window
        // rather than set into it: its own glass, a hairline, and the bevel
        // along the top edge that says the light is above it.
        "glass-composer flex w-full flex-col rounded-panel pb-2 transition-shadow duration-200 ease-out focus-within:ring-3 focus-within:ring-ring",
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
        // Set at the conversation step, not the UI step: what a person types
        // here is read back to them in the transcript at the same size.
        "max-h-[min(16rem,30svh)] min-h-14 resize-none overflow-y-auto rounded-panel border-0 bg-transparent px-5 py-4 text-conversation focus-visible:ring-0",
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
      className={cn(
        // Wrap rather than overlap: when the column is narrow the controls
        // must find a second line, not sit on top of one another.
        "flex flex-wrap items-center gap-2 px-2",
        className
      )}
      {...props}
    />
  )
}

export { PromptInput, PromptInputTextarea, PromptInputToolbar }
