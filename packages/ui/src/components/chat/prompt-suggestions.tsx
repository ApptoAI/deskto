"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export type PromptSuggestionOption = {
  id: string
  label: string
  description?: string
  meta?: string
  icon?: React.ReactNode
}

function PromptSuggestions({
  id,
  options,
  activeId,
  loading = false,
  emptyText,
  footerText,
  onActiveChange,
  onSelect,
  className,
}: {
  id: string
  options: PromptSuggestionOption[]
  activeId: string | null
  loading?: boolean
  emptyText: string
  footerText?: string
  onActiveChange: (id: string) => void
  onSelect: (id: string) => void
  className?: string
}) {
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    if (!activeId) return
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-suggestion-id="${CSS.escape(activeId)}"]`
      )
      ?.scrollIntoView({ block: "nearest" })
  }, [activeId])

  return (
    <div
      id={id}
      ref={listRef}
      role="listbox"
      aria-label="Prompt suggestions"
      className={cn(
        "max-h-72 w-full overflow-y-auto rounded-xl bg-popover p-1.5 text-popover-foreground shadow-xl ring-1 ring-foreground/10",
        className
      )}
    >
      {options.length > 0 ? (
        options.map((option) => (
          <div
            key={option.id}
            id={`${id}-${option.id}`}
            role="option"
            aria-selected={option.id === activeId}
            data-suggestion-id={option.id}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none",
              option.id === activeId && "bg-accent text-accent-foreground"
            )}
            onMouseEnter={() => onActiveChange(option.id)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option.id)}
          >
            {option.icon ? (
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {option.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{option.label}</span>
              {option.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
            {option.meta ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {option.meta}
              </span>
            ) : null}
          </div>
        ))
      ) : (
        <p
          className="px-3 py-2.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {loading ? "Searching…" : emptyText}
        </p>
      )}
      {/* Outside the option list on purpose: it counts what is not shown, so
          it must not be reachable with the arrow keys. */}
      {footerText && options.length > 0 ? (
        <p
          role="presentation"
          className="px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground"
        >
          {footerText}
        </p>
      ) : null}
    </div>
  )
}

export { PromptSuggestions }
