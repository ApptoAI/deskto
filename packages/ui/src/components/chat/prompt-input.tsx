import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { Textarea } from "@workspace/ui/components/textarea"

function PromptInput({ className, ...props }: React.ComponentProps<"form">) {
  return (
    <form
      data-slot="prompt-input"
      className={cn(
        // The composer uses one nearby opaque fill. Its inset hairline keeps
        // the long control from dissolving into the canvas without lifting it.
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-[13px] p-1.5 shadow-[inset_0_0_0_1px_var(--edge)] transition-[box-shadow] duration-180 ease-out glass-composer focus-within:ring-1 focus-within:ring-ring",
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
        "col-span-2 field-sizing-fixed max-h-[min(16rem,30svh)] min-h-10 min-w-0 resize-none overflow-y-auto rounded-panel border-0 bg-transparent px-2.5 py-2.5 text-conversation leading-5 focus-visible:ring-0",
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
        // Configuration and actions share a quiet rail below the writing
        // surface. Splitting the two groups keeps Send anchored and lets the
        // selectors yield space together instead of crowding the draft.
        "col-span-2 flex min-w-0 items-center justify-between gap-2 pt-0.5",
        className
      )}
      {...props}
    />
  )
}

export { PromptInput, PromptInputTextarea, PromptInputToolbar }
