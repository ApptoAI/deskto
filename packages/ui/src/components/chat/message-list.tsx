import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

const pinnedThreshold = 48

/** Space left above a row the list was told to scroll to. */
const jumpOffset = 24

interface MessageListHandle {
  /** Stops the list from following new content. */
  unpin(): void
  /**
   * Brings `element` to the top of the viewport and unpins on the way, so a
   * turn streaming in cannot drag the reader back down mid-jump.
   */
  scrollToElement(element: HTMLElement, offset?: number): void
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * Scroll container that follows new content while the reader is at the bottom
 * and leaves the scroll position alone once they have scrolled up.
 */
function MessageList({
  className,
  children,
  onScroll,
  onViewportChange,
  ref,
  ...props
}: Omit<React.ComponentProps<"div">, "ref"> & {
  ref?: React.Ref<MessageListHandle>
  /** Hands the scroll element out, for overlays that measure or observe it. */
  onViewportChange?: (viewport: HTMLDivElement | null) => void
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const pinnedRef = React.useRef(true)

  React.useImperativeHandle(ref, () => {
    return {
      unpin() {
        pinnedRef.current = false
      },
      scrollToElement(element, offset = jumpOffset) {
        const viewport = viewportRef.current
        if (!viewport) return
        pinnedRef.current = false
        // Measured through client rects rather than offsetTop: the row's
        // offset parent is whatever the caller wrapped the list in, which is
        // not necessarily the scroller itself.
        const top =
          element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop -
          offset
        viewport.scrollTo({
          top: Math.max(0, top),
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        })
      },
    }
  }, [])

  const setViewport = React.useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node
      onViewportChange?.(node)
    },
    [onViewportChange]
  )

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !pinnedRef.current) return
    viewport.scrollTop = viewport.scrollHeight
  })

  return (
    <div
      ref={setViewport}
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

export { MessageList, type MessageListHandle }
