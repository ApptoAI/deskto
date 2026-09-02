import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

const messageVariants = cva("flex w-full", {
  variants: {
    role: {
      user: "justify-end",
      assistant: "justify-start",
      system: "justify-center",
    },
  },
  defaultVariants: { role: "assistant" },
})

/*
 * The conversation is the app's primary reading surface, so it is set a step
 * above UI copy. What the person said is a compact flat bubble; what the agent
 * said is unenclosed, at full measure, because it is the page rather than a
 * remark on it.
 */
const messageBodyVariants = cva("min-w-0 text-sm", {
  variants: {
    role: {
      user: "max-w-[84%] rounded-bubble bg-fill-bubble px-4 py-2.5 text-conversation leading-[1.5] break-words text-pretty whitespace-pre-wrap",
      assistant: "w-full text-conversation leading-[1.62] text-body",
      system: "max-w-[80%] text-center text-xs text-muted-foreground",
    },
  },
  defaultVariants: { role: "assistant" },
})

type MessageRole = NonNullable<VariantProps<typeof messageVariants>["role"]>

function Message({
  role,
  className,
  ...props
}: React.ComponentProps<"div"> & { role: MessageRole }) {
  return (
    <div
      data-slot="message"
      data-role={role}
      className={cn(messageVariants({ role }), className)}
      {...props}
    />
  )
}

function MessageBody({
  role,
  className,
  ...props
}: React.ComponentProps<"div"> & { role: MessageRole }) {
  return (
    <div
      data-slot="message-body"
      className={cn(messageBodyVariants({ role }), className)}
      {...props}
    />
  )
}

/** Quiet, non-blocking status line, e.g. "Working…" while a turn runs. */
function MessageActivity({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="message-activity"
      aria-live="polite"
      className={cn(
        "text-sm text-muted-foreground motion-safe:animate-pulse",
        className
      )}
      {...props}
    >
      {children}
    </p>
  )
}

export { Message, MessageBody, MessageActivity, type MessageRole }
