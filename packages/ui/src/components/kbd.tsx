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
        "inline-flex h-5 shrink-0 items-center justify-center rounded border border-border/70 bg-muted px-1.5 font-sans text-[11px] leading-none font-medium text-muted-foreground tabular-nums select-none",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
