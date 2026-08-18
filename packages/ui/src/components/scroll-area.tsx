"use client"

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Scroll container with an overlay scrollbar that only shows while the
 * pointer is over the region or the content is moving, plus an optional
 * edge fade that reveals itself in step with how much is scrolled out of
 * view — so a list that fits looks untouched.
 *
 * A region that needs the viewport itself — a ref, a role, its own scroll
 * handler — composes `ScrollAreaRoot`, `ScrollAreaViewport`, and `ScrollBar`
 * instead of passing all of that through here.
 */
function ScrollArea({
  className,
  children,
  scrollFade = false,
  hideScrollbars = false,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean
  hideScrollbars?: boolean
}) {
  return (
    <ScrollAreaRoot className={cn("size-full", className)} {...props}>
      <ScrollAreaViewport
        className={cn(
          "max-h-[inherit] overscroll-contain rounded-[inherit]",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] [--fade-size:1.5rem]",
          hideScrollbars &&
            "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {children}
      </ScrollAreaViewport>
      {hideScrollbars ? null : (
        <>
          <ScrollBar orientation="vertical" />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
        </>
      )}
    </ScrollAreaRoot>
  )
}

/** The box the scrollbars are positioned against. */
function ScrollAreaRoot({
  className,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn(
        "relative min-h-0 overflow-hidden rounded-[inherit]",
        className
      )}
      {...props}
    />
  )
}

/**
 * The scrolling element, and the one to hold a ref to: it is what carries the
 * scroll position and the rows a caller may want to measure.
 */
function ScrollAreaViewport({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Viewport.Props) {
  return (
    // Base UI turns the viewport into a real tab stop the moment its content
    // overflows, so suppressing the outline without putting anything back
    // strands a keyboard user with no sign of where focus landed. The ring is
    // inset because the Root clips overflow, which would swallow a ring drawn
    // outside the viewport's edge.
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      className={cn(
        "h-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className
      )}
      {...props}
    >
      {/* The content wrapper is what watches for size changes, so a list that
          grows (a shelf expanding, a row arriving) re-measures its overflow
          instead of keeping a stale fade. Its `fit-content` minimum would
          stretch to the widest untruncated row, so the width stays pinned to
          the viewport. */}
      <ScrollAreaPrimitive.Content
        data-slot="scroll-area-content"
        style={{ minWidth: 0 }}
      >
        {children}
      </ScrollAreaPrimitive.Content>
    </ScrollAreaPrimitive.Viewport>
  )
}

/**
 * `reveal` says what brings the bar out. `"hover"`, the default, shows it
 * whenever the pointer is anywhere over the region. `"scroll"` shows it while
 * the view is moving and while the pointer is on the bar itself, and keeps it
 * hidden the rest of the time — for a region that carries its own way of
 * getting around and should stay clean while it is only being read. Either
 * way the bar keeps its width, so it can be grabbed where it is drawn.
 */
function ScrollBar({
  className,
  orientation = "vertical",
  reveal = "hover",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props & { reveal?: "hover" | "scroll" }) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex opacity-0 transition-opacity delay-300 data-scrolling:opacity-100 data-scrolling:delay-0 data-scrolling:duration-100 data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:mb-px data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:my-1 data-[orientation=vertical]:mr-px data-[orientation=vertical]:w-1.5 motion-reduce:transition-none",
        reveal === "hover"
          ? "data-hovering:opacity-100 data-hovering:delay-0 data-hovering:duration-100"
          : // Its own hover, so reaching for the edge draws the bar before the
            // press lands, and a held thumb stays lit once the scroll settles.
            "hover:opacity-100 hover:delay-0 hover:duration-100",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-[var(--app-scrollbar-thumb,var(--color-border))] transition-colors hover:bg-[var(--app-scrollbar-thumb-hover,var(--color-muted-foreground))]"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollAreaRoot, ScrollAreaViewport, ScrollBar }
