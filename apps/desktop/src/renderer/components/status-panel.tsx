import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

/** Centred explanation for loading, empty, and failed screens. */
export function StatusPanel({
  title,
  description,
  tone = "default",
  children,
}: {
  title: string
  description?: string
  tone?: "default" | "danger"
  children?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <h2
        className={cn(
          "font-heading text-base font-medium",
          tone === "danger" && "text-destructive"
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children ? (
        <div className="mt-1 flex items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}
