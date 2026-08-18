import * as React from "react"

import {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from "@workspace/ui/components/scroll-area"

const pinnedThreshold = 48

/** Space left above a row the list was told to scroll to. */
const jumpOffset = 24

/** Backstop for a jump that never reports a `scrollend`, e.g. one that had
    nowhere to travel. */
const jumpSettleMs = 700

interface MessageListHandle {
  /**
   * Brings `element` to the top of the viewport and unpins on the way, so a
   * turn streaming in cannot drag the reader back down mid-jump. Focus lands
   * on the element, so a jump reads as arriving somewhere.
   */
  scrollToElement(element: HTMLElement, offset?: number): void
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Scroll container that follows new content while the reader is at the bottom
 * and leaves the scroll position alone once they have scrolled up.
 *
 * Its scrollbar floats over the conversation and comes out while the view is
 * moving or the pointer is on the bar: a permanent lane down the right edge
 * would take the measure's air and sit against whatever the conversation is
 * placed beside.
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
  const jumpingRef = React.useRef(false)
  const jumpTimerRef = React.useRef<number | null>(null)

  const endJump = React.useCallback(() => {
    jumpingRef.current = false
    if (jumpTimerRef.current !== null) {
      window.clearTimeout(jumpTimerRef.current)
      jumpTimerRef.current = null
    }
  }, [])

  React.useEffect(() => endJump, [endJump])

  React.useImperativeHandle(ref, () => {
    return {
      scrollToElement(element, offset = jumpOffset) {
        const viewport = viewportRef.current
        if (!viewport) return
        pinnedRef.current = false
        // A smooth scroll leaves the bottom slowly, so its own first scroll
        // events still read as "at the bottom" and would re-pin the list.
        // Hold that off until the jump lands.
        jumpingRef.current = true
        if (jumpTimerRef.current !== null) {
          window.clearTimeout(jumpTimerRef.current)
        }
        jumpTimerRef.current = window.setTimeout(endJump, jumpSettleMs)
        viewport.addEventListener("scrollend", endJump, { once: true })

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
        element.focus({ preventScroll: true })
      },
    }
  }, [endJump])

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
    <ScrollAreaRoot className="flex-1">
      <ScrollAreaViewport
        ref={setViewport}
        data-slot="message-list"
        role="log"
        className={className}
        onScroll={(event) => {
          if (!jumpingRef.current) {
            const viewport = event.currentTarget
            const distanceToBottom =
              viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
            pinnedRef.current = distanceToBottom < pinnedThreshold
          }
          onScroll?.(event)
        }}
        {...props}
      >
        {children}
      </ScrollAreaViewport>
      {/* Only the one bar: a row too wide for the column — a table, a code
          block — scrolls sideways inside itself, so the conversation never
          travels that way. Held off the edge so the bar reads as part of the
          conversation rather than a rule drawn against what sits beside it. */}
      <ScrollBar
        orientation="vertical"
        reveal="scroll"
        className="data-[orientation=vertical]:mr-1"
      />
    </ScrollAreaRoot>
  )
}

export { MessageList, type MessageListHandle }
