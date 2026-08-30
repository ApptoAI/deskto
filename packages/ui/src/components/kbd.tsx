import type { ComponentProps } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * A keyboard shortcut hint, sized to sit inside a button or menu row without
 * pushing it taller. Quiet by design: it teaches the shortcut, it is not a
 * control. The fill is `--muted` rather than a wash of the page, because a
 * hint sits inside buttons, menus and popovers alike and the light palette's
 * popover is plain white.
 */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center rounded-sm border border-edge-button bg-transparent px-1.5 font-mono text-tiny leading-none text-muted-foreground tabular-nums select-none",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
