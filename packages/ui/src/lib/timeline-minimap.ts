/**
 * Placement rules for the conversation minimap: the column of ticks pinned to
 * the left gutter of a chat scroller, one tick per user message. Kept free of
 * React and the DOM so every rule can be tested as plain arithmetic.
 *
 * Ticks sit at even intervals rather than at their real scroll offsets. The
 * rail indexes the conversation, it does not scale it, so a long turn cannot
 * push its neighbours into an unclickable clump.
 */

/** Vertical distance between two ticks before the rail hits its height cap. */
export const minimapItemSpacing = 8

/** Under two stops the rail has no shape worth drawing. */
export const minimapMinItems = 2

/** Past this the rail stops growing and compresses its spacing instead. */
export const minimapMaxHeight = "calc(100vh - 18rem)"

/** Width of the centered message column, matching its `max-w-3xl`. */
export const minimapContentMaxWidth = 768

/** Horizontal padding the scroller holds around that column, its `px-6`. */
export const minimapContentPadding = 24

/** From this gutter up there is room to keep the rail on screen; below it the
    rail hides and comes back on hover. */
export const minimapPersistentGutter = 48

/** Inset of the rail from the viewport's left edge. */
export const minimapHitStripLeft = 12

/** Widest the collapsed hover target ever gets, gutter permitting. */
export const minimapHitStripMaxWidth = 40

/** With the preview open the target covers the card too, so the pointer can
    travel to it and select its text. */
export const minimapExpandedHitStripWidth = "22rem"

export function minimapHeightStyle(itemCount: number): string {
  const natural = Math.max(1, (itemCount - 1) * minimapItemSpacing)
  return `min(${natural}px, ${minimapMaxHeight})`
}

export function minimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) return 0
  const clamped = Math.max(0, Math.min(index, itemCount - 1))
  return (clamped / (itemCount - 1)) * 100
}

/**
 * Which stop the pointer is nearest. The whole rail is one hover target, so
 * every Y lands on some tick and there are no dead gaps between them.
 */
export function minimapIndexFromPointer(input: {
  itemCount: number
  railTop: number
  railHeight: number
  pointerY: number
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) return null
  if (input.itemCount === 1) return 0

  const raw = (input.pointerY - input.railTop) / input.railHeight
  const progress = Math.max(0, Math.min(1, raw))
  return Math.round(progress * (input.itemCount - 1))
}

/** Free space between the viewport edge and the centered message column. */
function minimapGutter(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0
  const available = Math.max(0, viewportWidth - minimapContentPadding * 2)
  const contentWidth = Math.min(available, minimapContentMaxWidth)
  return Math.max(0, (viewportWidth - contentWidth) / 2)
}

export function minimapHasPersistentGutter(viewportWidth: number): boolean {
  return minimapGutter(viewportWidth) >= minimapPersistentGutter
}

/**
 * Width of the collapsed hover target, capped to the gutter. A fixed width
 * would reach over the message column in a narrow window and swallow the
 * clicks meant for the text. The scroller's own padding keeps a usable sliver
 * at any real window size; zero only comes up in a degenerate viewport, and
 * turns the rail inert.
 */
export function minimapHitStripWidth(viewportWidth: number): number {
  const usable = Math.floor(minimapGutter(viewportWidth)) - minimapHitStripLeft
  return Math.max(0, Math.min(minimapHitStripMaxWidth, usable))
}

export function minimapInteractiveWidth(
  collapsedWidth: number,
  expanded: boolean
): number | string {
  return expanded ? minimapExpandedHitStripWidth : collapsedWidth
}

/**
 * Keeps the preview inside the rail: the first stop hangs below its tick, the
 * last one above it, everything in between stays centered on it.
 */
export function minimapPreviewTranslate(
  index: number,
  itemCount: number
): string {
  if (index <= 0) return "0%"
  if (index >= itemCount - 1) return "-100%"
  return "-50%"
}

/**
 * A message reduced to one line of prose for the hover card. Markdown that
 * only reads as noise at this size goes away; link and emphasis text stays.
 * Underscores survive, since `snake_case` shows up here far more often than
 * underscore emphasis does.
 */
export function minimapPreviewText(
  text: string | null | undefined
): string | null {
  const compact = (text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
  return compact.length > 0 ? compact : null
}
