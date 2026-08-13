import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

const pinnedThreshold = 48

/**
 * Scroll container that follows new content while the reader is at the bottom
 * and leaves the scroll position alone once they have scrolled up.
 */
function MessageList({
  className,
  children,
  onScroll,
  ...props
}: React.ComponentProps<"div">) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const pinnedRef = React.useRef(true)

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !pinnedRef.current) return
    viewport.scrollTop = viewport.scrollHeight
  })

  return (
    <div
      ref={viewportRef}
      data-slot="message-list"
      role="log"
      tabIndex={0}
      className={cn("min-h-0 flex-1 overflow-y-auto outline-none", className)}
      onScroll={(event) => {
        const viewport = event.currentTarget
        const distanceToBottom =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
        pinnedRef.current = distanceToBottom < pinnedThreshold
        onScroll?.(event)
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export { MessageList }
