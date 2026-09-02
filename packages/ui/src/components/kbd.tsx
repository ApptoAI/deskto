import type { ComponentProps } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * A keyboard shortcut hint, sized to sit inside a button or menu row without
 * pushing it taller. Quiet by design: it teaches the shortcut, it is not a
 * control. An ink plate rather than a border, so it reads the same inside a
 * button, a menu row, and a white popover.
 */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center rounded-key bg-foreground/6 px-1.5 font-mono text-tiny leading-none text-muted-foreground/80 tabular-nums select-none",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
