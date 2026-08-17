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

const messageBodyVariants = cva("min-w-0 text-sm", {
  variants: {
    role: {
      user: "max-w-[80%] rounded-2xl bg-card px-4 py-2.5 text-reading leading-relaxed whitespace-pre-wrap ring-1 ring-border",
      assistant: "w-full",
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
      className={cn("animate-pulse text-sm text-muted-foreground", className)}
      {...props}
    >
      {children}
    </p>
  )
}

export { Message, MessageBody, MessageActivity, type MessageRole }
