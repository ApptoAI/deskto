"use client"

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Scroll container with an overlay scrollbar that only shows while the
 * pointer is over the region or the content is moving, plus an optional
 * edge fade that reveals itself in step with how much is scrolled out of
 * view — so a list that fits looks untouched.
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
    <ScrollAreaPrimitive.Root
      className={cn(
        "relative size-full min-h-0 overflow-hidden rounded-[inherit]",
        className
      )}
      {...props}
    >
      {/* Base UI turns the viewport into a real tab stop the moment its
          content overflows, so suppressing the outline without putting
          anything back strands a keyboard user with no sign of where focus
          landed. The ring is inset because the Root clips overflow, which
          would swallow a ring drawn outside the viewport's edge. */}
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "h-full max-h-[inherit] overflow-auto overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          scrollFade &&
            "mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] [--fade-size:1.5rem]",
          hideScrollbars &&
            "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {/* The content wrapper is what watches for size changes, so a list
            that grows (a shelf expanding, a row arriving) re-measures its
            overflow instead of keeping a stale fade. Its `fit-content`
            minimum would stretch to the widest untruncated row, so the
            width stays pinned to the viewport. */}
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          style={{ minWidth: 0 }}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      {hideScrollbars ? null : (
        <>
          <ScrollBar orientation="vertical" />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
        </>
      )}
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex opacity-0 transition-opacity delay-300 data-hovering:opacity-100 data-hovering:delay-0 data-hovering:duration-100 data-scrolling:opacity-100 data-scrolling:delay-0 data-scrolling:duration-100 data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:mb-px data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:my-1 data-[orientation=vertical]:mr-px data-[orientation=vertical]:w-1.5",
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

export { ScrollArea, ScrollBar }
