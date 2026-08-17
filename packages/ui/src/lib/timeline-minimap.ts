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

/**
 * Floor on the hover target's height. At its natural spacing a two-stop rail
 * would be 8px tall, which is a target nobody can hit; short conversations get
 * a strip that is reachable instead of one that is proportional. The ticks
 * themselves keep their spacing and sit centered in it.
 */
export const minimapMinHeight = 48

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

/** Height of the hover target, padded out for the pointer on short rails. */
export function minimapHeightStyle(itemCount: number): string {
  const natural = Math.max(minimapMinHeight, minimapTrackHeight(itemCount))
  return `min(${natural}px, ${minimapMaxHeight})`
}

/**
 * Height of the tick column alone, which the padded hover target must not
 * stretch: a two-stop rail keeps its stops 8px apart wherever the strip ends.
 */
export function minimapTrackHeightStyle(itemCount: number): string {
  return `min(${minimapTrackHeight(itemCount)}px, ${minimapMaxHeight})`
}

function minimapTrackHeight(itemCount: number): number {
  return Math.max(0, (itemCount - 1) * minimapItemSpacing)
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

type MinimapVerticalBounds = {
  top: number
  bottom: number
}

/**
 * Stops whose prompt is visible, or the prompt that opened the Turn currently
 * crossing the viewport when a long reply has pushed every prompt off screen.
 */
export function minimapHighlightedIndexes(input: {
  anchorCount: number
  anchorAt: (index: number) => MinimapVerticalBounds
  viewport: MinimapVerticalBounds
}): number[] {
  if (input.anchorCount <= 0) return []

  const measured = new Map<number, MinimapVerticalBounds>()
  const anchorAt = (index: number) => {
    const cached = measured.get(index)
    if (cached) return cached
    const anchor = input.anchorAt(index)
    measured.set(index, anchor)
    return anchor
  }

  // Prompt positions follow conversation order. Find the first one that has
  // not passed the viewport, then inspect only the prompts that can be seen.
  let low = 0
  let high = input.anchorCount
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (anchorAt(middle).bottom < input.viewport.top) low = middle + 1
    else high = middle
  }

  const visible: number[] = []
  for (let index = low; index < input.anchorCount; index++) {
    const anchor = anchorAt(index)
    if (anchor.top > input.viewport.bottom) break
    if (
      anchor.bottom >= input.viewport.top &&
      anchor.top <= input.viewport.bottom
    ) {
      visible.push(index)
    }
  }

  if (visible.length > 0) return visible
  return low > 0 ? [low - 1] : []
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
