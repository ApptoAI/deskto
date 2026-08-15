import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import {
  minimapHasPersistentGutter,
  minimapHeightStyle,
  minimapHitStripWidth,
  minimapIndexFromPointer,
  minimapMinItems,
  minimapPreviewTranslate,
  minimapTopPercent,
} from "@workspace/ui/lib/timeline-minimap"

const anchorAttribute = "data-minimap-anchor"

interface TimelineMinimapItem {
  id: string
  /** Headline of the hover card, usually the prompt that opened the turn. */
  label: string
  /** Second line of the card, clamped to three lines. */
  preview?: string | null
}

/**
 * Marks a row as a minimap stop. Spread onto the element the rail should
 * scroll to and watch, keeping the attribute name in one place. The row is
 * made programmatically focusable so a jump can land focus on it without
 * adding a tab stop per message.
 */
function minimapAnchor(id: string): {
  "data-minimap-anchor": string
  tabIndex: number
} {
  return { [anchorAttribute]: id, tabIndex: -1 }
}

function anchorSelector(id: string): string {
  const escaped = typeof CSS !== "undefined" ? CSS.escape(id) : id
  return `[${anchorAttribute}="${escaped}"]`
}

/**
 * A column of ticks over the left gutter of a chat scroller, one per stop,
 * with a hover card previewing the turn and a click that jumps to it. Ticks
 * near the pointer widen so the rail reads as a fan around the cursor, and a
 * stop currently on screen keeps its tick lit.
 *
 * Pointer-driven, so it stays out of touch layouts entirely.
 */
function TimelineMinimap({
  items,
  viewport,
  onSelect,
}: {
  items: readonly TimelineMinimapItem[]
  /** The scroll container holding the anchors, also the rail's measuring stick. */
  viewport: HTMLElement | null
  onSelect: (anchor: HTMLElement) => void
}) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const [gutter, setGutter] = React.useState({ persistent: false, strip: 0 })
  const ticksRef = React.useRef(new Map<string, HTMLSpanElement>())

  React.useEffect(() => {
    if (!viewport) return

    const measure = () => {
      const width = viewport.getBoundingClientRect().width
      const next = {
        persistent: minimapHasPersistentGutter(width),
        strip: minimapHitStripWidth(width),
      }
      setGutter((current) =>
        current.persistent === next.persistent && current.strip === next.strip
          ? current
          : next
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  // Keyed on the stop ids alone, so a turn streaming in re-renders the rail
  // without tearing the observer down and re-querying every anchor. Joined on
  // NUL, which no id can carry, so the key splits back to the same list.
  const anchorKey = items.map((item) => item.id).join("\0")

  // Which stops are on screen, written straight onto the tick nodes. An
  // observer fires only when a row crosses the edge, and skipping React here
  // keeps the rail off the scroll path entirely.
  React.useEffect(() => {
    if (!viewport) return

    const ticks = ticksRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute(anchorAttribute)
          const tick = id === null ? undefined : ticks.get(id)
          if (tick)
            tick.dataset.inView = entry.isIntersecting ? "true" : "false"
        }
      },
      { root: viewport }
    )

    for (const id of anchorKey.split("\0")) {
      const anchor = viewport.querySelector(anchorSelector(id))
      if (anchor) observer.observe(anchor)
    }
    return () => observer.disconnect()
  }, [anchorKey, viewport])

  const resolveIndexFromPointer = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const rail = event.currentTarget.getBoundingClientRect()
      return minimapIndexFromPointer({
        itemCount: items.length,
        railTop: rail.top,
        railHeight: rail.height,
        pointerY: event.clientY,
      })
    },
    [items.length]
  )

  const jumpTo = React.useCallback(
    (item: TimelineMinimapItem | null) => {
      if (!item || !viewport) return
      const anchor = viewport.querySelector(anchorSelector(item.id))
      if (anchor instanceof HTMLElement) onSelect(anchor)
    },
    [onSelect, viewport]
  )

  // An index held over a shrinking list would point past the end.
  const index =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null
  const activeItem = index === null ? null : (items[index] ?? null)

  if (items.length < minimapMinItems) return null

  return (
    <div
      data-slot="timeline-minimap"
      className={cn(
        "pointer-events-none absolute inset-y-0 left-0 z-30 hidden w-18 [@media(pointer:fine)]:block",
        gutter.persistent
          ? "opacity-100"
          : "opacity-0 transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100 motion-reduce:transition-none"
      )}
    >
      <div className="relative h-full w-full select-none">
        <button
          type="button"
          aria-label={
            activeItem && index !== null
              ? `Jump to message ${index + 1} of ${items.length}: ${activeItem.label}`
              : "Jump to a message"
          }
          className={cn(
            "absolute top-1/2 left-3 -translate-y-1/2 cursor-pointer bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            // Never wider than the gutter, so the rail cannot reach over the
            // message column; with no room to spare it goes inert instead.
            gutter.strip > 0 ? "pointer-events-auto" : "pointer-events-none"
          )}
          style={{
            height: minimapHeightStyle(items.length),
            width: gutter.strip,
          }}
          onMouseMove={(event) =>
            setActiveIndex(resolveIndexFromPointer(event))
          }
          onMouseLeave={() => setActiveIndex(null)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const next = resolveIndexFromPointer(event)
            jumpTo(next === null ? null : (items[next] ?? null))
            event.currentTarget.blur()
          }}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onBlur={() => setActiveIndex(null)}
          onKeyDown={(event) => {
            const step = (delta: number) => {
              event.preventDefault()
              setActiveIndex((current) =>
                Math.max(0, Math.min(items.length - 1, (current ?? 0) + delta))
              )
            }
            if (event.key === "ArrowDown") step(1)
            else if (event.key === "ArrowUp") step(-1)
            else if (event.key === "Home") {
              event.preventDefault()
              setActiveIndex(0)
            } else if (event.key === "End") {
              event.preventDefault()
              setActiveIndex(items.length - 1)
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              jumpTo(activeItem)
            }
          }}
        >
          <span
            aria-hidden
            className="absolute top-0 left-3 h-full w-px bg-border/40"
          />
          {items.map((item, tickIndex) => {
            const distance = index === null ? null : Math.abs(tickIndex - index)
            return (
              <span
                key={item.id}
                aria-hidden
                data-in-view="false"
                ref={(node) => {
                  if (node) ticksRef.current.set(item.id, node)
                  else ticksRef.current.delete(item.id)
                }}
                style={{
                  top: `${minimapTopPercent(tickIndex, items.length)}%`,
                }}
                className={cn(
                  "pointer-events-none absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-[background-color,width] duration-150 data-[in-view=true]:bg-foreground/90 motion-reduce:transition-none",
                  distance === 0
                    ? "w-6 bg-muted-foreground/75"
                    : distance === 1
                      ? "w-4"
                      : distance === 2
                        ? "w-2.5"
                        : "w-2"
                )}
              />
            )
          })}
          {activeItem && index !== null ? (
            // Inert on purpose. The card overhangs the message column, so
            // anything it caught would be a click or a drag-select the reader
            // aimed at the text underneath.
            <span
              aria-hidden
              className="pointer-events-none absolute left-8 w-80"
              style={{
                top: `${minimapTopPercent(index, items.length)}%`,
                transform: `translateY(${minimapPreviewTranslate(index, items.length)})`,
              }}
            >
              <span className="block rounded-lg bg-popover p-3 text-left text-popover-foreground shadow-md ring-1 ring-foreground/10">
                <span className="block truncate text-sm leading-5 font-medium">
                  {activeItem.label}
                </span>
                {activeItem.preview ? (
                  <span className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">
                    {activeItem.preview}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </button>
      </div>
    </div>
  )
}

export { TimelineMinimap, minimapAnchor, type TimelineMinimapItem }
